const assert = require('node:assert/strict');
const { ScalingRecord, withScalingContext, seedScalingGraph, dropScalingTables } = require('./scaling-model');
const { measure, budgets } = require('./workload-measurement');

function limitedSource(source, limit) {
  return {
    providerName: source.providerName, dialect: { ...source.dialect, maxStatementParameters: () => limit },
    migrationDialect: source.migrationDialect, createMigrationBuilder: source.createMigrationBuilder,
    valueReader: source.valueReader, createConnection: () => source.createConnection(),
  };
}

async function scalingWorkloads(source, raw, provider, counters) {
  const results = [];
  await seedScalingGraph(raw, provider, source, counters);
  for (const size of [250, 1_000]) {
    results.push(await measure(`orm.inverse-include-${size}`, counters, () => withScalingContext(source, counters, async db => {
      const children = await db.children.where(row => row.id.gte(100_000)).orderBy(row => row.id).take(size).include(row => row.parent).toArray();
      assert.equal(children.length, size);
      const parent = children[0].parent;
      assert.equal(parent.children.length, size);
      assert.ok(children.every(child => child.parent === parent));
      assert.deepEqual(parent.children, children);
    }), 8, 2, budgets.batchP95Ms));
    results.push(await measure(`orm.collection-include-${size}`, counters, () => withScalingContext(source, counters, async db => {
      const [parent] = await db.parents.where(row => row.id.eq(1)).include(row => row.children.where(child => child.id.gte(100_000)).orderBy(child => child.id).take(size)).toArray();
      assert.equal(parent.children.length, size);
      assert.ok(parent.children.every(child => child.parent === parent));
      assert.equal(new Set(parent.children).size, size);
    }), 8, 2, budgets.batchP95Ms));
  }
  results.push(await measure('orm.composite-include-1024', counters, () => withScalingContext(source, counters, async db => {
    const children = await db.children.where(row => row.id.lt(100_000).and(row.score.eq(0))).orderBy(row => row.id).include(row => row.parent).toArray();
    assert.equal(children.length, 1_024);
    assert.ok(children.every(child => child.parent.scope === child.scope && child.parent.id === child.parentId));
    assert.equal(new Set(children.map(child => child.parent)).size, 1_024);
  }), 8, 5, budgets.batchP95Ms));
  results.push(await measure('orm.composite-collections-1024', counters, () => withScalingContext(source, counters, async db => {
    const parents = await db.parents.orderBy(row => row.id).include(row => row.children.where(child => child.id.lt(100_000))).toArray();
    assert.equal(parents.length, 1_024);
    assert.ok(parents.every(parent => parent.children.length === 4 && parent.children.every(child => child.parent === parent)));
  }), 8, 5, budgets.batchP95Ms));
  const capped = limitedSource(source, 96);
  const scores = Array.from({ length: 80 }, (_, index) => index);
  for (const navigation of ['children', 'tags']) {
    results.push(await measure(`orm.${navigation}-windows-33-cap96`, counters, () => withScalingContext(capped, counters, async db => {
      const query = db.windowParents.orderBy(row => row.id);
      const parents = await (navigation === 'children'
        ? query.include(row => row.children.where(child => child.score.in(scores)).orderBy(child => child.score).skip(1).take(2))
        : query.include(row => row.tags.where(tag => tag.score.in(scores)).orderBy(tag => tag.score).skip(1).take(2))).asNoTracking().toArray();
      assert.equal(parents.length, 33);
      assert.ok(parents.every(parent => {
        const rows = parent[navigation];
        return rows.length === 2 && rows[0].score === 1 && rows[1].score === 2;
      }));
      assert.equal(db.changeTracker.entries().length, 0);
      assert.ok(counters.maxParameters <= 96, 'Window/filter batching exceeded the configured parameter cap.');
      if (navigation === 'tags') {
        const tag = parents[0].tags[0];
        assert.ok(parents.every(parent => parent.tags[0] === tag));
        assert.equal(new Set(tag.windowParents).size, 33);
        assert.ok(parents.every(parent => parent.tags.every(value => value.workspaceId === 1)));
      }
    }), 8, 4, budgets.batchP95Ms));
  }
  for (const tracking of [true, false]) {
    results.push(await measure(`orm.converted-${tracking ? 'tracked' : 'no-tracking'}-1000`, counters, () => withScalingContext(source, counters, async db => {
      const query = tracking ? db.records : db.records.asNoTracking();
      const rows = await query.orderBy(row => row.id).take(1_000).toArray();
      assert.equal(rows.length, 1_000);
      assert.ok(rows.every(row => row.payload.nested.label === 'original'));
      assert.equal(db.changeTracker.entries().length, tracking ? 1_000 : 0);
      if (tracking) {
        db.changeTracker.detectChanges();
        assert.equal(await db.saveChanges(), 0);
      }
    }), 8, 1, budgets.batchP95Ms));
  }
  for (const size of [100, 400]) {
    results.push(await measure(`orm.generated-save-delete-cycle-${size}`, counters, () => withScalingContext(source, counters, async db => {
      const rows = Array.from({ length: size }, () => new ScalingRecord());
      for (const row of rows) db.records.add(row);
      assert.equal(await db.saveChanges(), size);
      assert.equal(new Set(rows.map(row => row.id)).size, size);
      assert.ok(rows.every(row => row.id > 0));
      for (const row of rows) db.records.remove(row);
      assert.equal(await db.saveChanges(), size);
      assert.equal(db.changeTracker.entries().length, 0);
    }), 8, 2 * size, budgets.batchP95Ms));
  }
  const rollback = new Error('qualified cascade rollback');
  results.push(await measure('orm.reverse-cascade-delete-rollback-400', counters, () => withScalingContext(source, counters, async db => {
    await assert.rejects(db.transaction(async () => {
      const nodes = await db.nodes.orderByDescending(row => row.id).toArray();
      assert.equal(nodes.length, 400);
      db.nodes.remove(nodes.at(-1));
      db.changeTracker.detectChanges();
      assert.ok(nodes.every(node => node.parent === null && node.children.length === 0));
      assert.equal(await db.saveChanges(), 400);
      assert.equal(await db.nodes.count(), 0);
      throw rollback;
    }), error => error === rollback);
  }), 8, 402, budgets.batchP95Ms));
  assert.equal(Number((await raw.query('select count(*) as total from entitykit_scaling_nodes'))[0].total), 400);
  assert.equal(Number((await raw.query('select count(*) as total from entitykit_scaling_records'))[0].total), 1_000);
  return { results, cleanup: () => dropScalingTables(raw) };
}

module.exports = { scalingWorkloads };
