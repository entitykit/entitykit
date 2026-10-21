const assert = require('node:assert/strict');
const { DbContext, DeleteBehavior } = require('@entitykit/core');
const { parameter } = require('./direct-driver');
const { measure, budgets } = require('./workload-measurement');

class RemovalParent { id = 0; children = []; }
class RemovalChild { id = 0; parentId = null; parent = null; }
class RemovalContext extends DbContext {
  parents = this.set(RemovalParent);
  children = this.set(RemovalChild);
  constructor(source, counters, behavior) { super(source); this.counters = counters; this.behavior = behavior; }
  configure(options) {
    options.useDiagnostics(event => {
      if (event.kind === 'query') {
        this.counters.queries += 1;
        this.counters.maxParameters = Math.max(this.counters.maxParameters, event.statement.values.length);
      }
    });
  }
  model(model) {
    model.entity(RemovalParent, entity => {
      entity.toTable('entitykit_scaling_removal_parents').hasKey(row => row.id);
      entity.property(row => row.id).hasColumnType('integer').isRequired();
    });
    model.entity(RemovalChild, entity => {
      entity.toTable('entitykit_scaling_removal_children').hasKey(row => row.id);
      entity.property(row => row.id).hasColumnType('integer').isRequired();
      entity.property(row => row.parentId).hasColumnName('parent_id').hasColumnType('integer');
      entity.hasOne(RemovalParent, row => row.parent).withMany(row => row.children)
        .hasForeignKey(row => row.parentId).onDelete(this.behavior);
    });
  }
}

async function cascadeRemovalWorkloads(source, raw, provider, counters) {
  const results = [];
  const drop = async () => {
    for (const table of ['children', 'parents']) await raw.query(`drop table if exists entitykit_scaling_removal_${table}`);
  };
  const withContext = async (behavior, work) => {
    const db = RemovalContext.create(source, counters, behavior);
    try { return await work(db); } finally { await db.dispose(); }
  };
  try {
    for (const behavior of [DeleteBehavior.Cascade, DeleteBehavior.SetNull]) {
      await drop();
      await withContext(behavior, db => db.database.ensureCreated());
      for (const size of [250, 1_000]) {
        const prepare = async () => {
          await raw.query('delete from entitykit_scaling_removal_children');
          await raw.query('delete from entitykit_scaling_removal_parents');
          await raw.query('insert into entitykit_scaling_removal_parents values (1)');
          for (let start = 0; start < size; start += 100) {
            const ids = Array.from({ length: Math.min(100, size - start) }, (_, offset) => start + offset + 1);
            const tuples = ids.map((id, index) => `(${parameter(provider, index + 1)}, 1)`);
            await raw.query(`insert into entitykit_scaling_removal_children values ${tuples.join(', ')}`, ids);
          }
        };
        results.push(await measure(`orm.loaded-${behavior.toLowerCase()}-removal-rollback-${size}`, counters,
          () => withContext(behavior, async db => {
            const parent = await db.parents.include(row => row.children).single();
            const children = [...parent.children];
            assert.equal(children.length, size);
            db.parents.remove(parent);
            const rollback = new Error('qualified loaded inverse rollback');
            await assert.rejects(db.transaction(async () => {
              assert.equal(await db.saveChanges(), size + 1);
              assert.deepEqual(parent.children, []);
              assert.ok(children.every(child => child.parent === null));
              assert.equal(await db.parents.count(), 0);
              assert.equal(await db.children.count(), behavior === DeleteBehavior.Cascade ? 0 : size);
              throw rollback;
            }), error => error === rollback);
            assert.deepEqual(parent.children, children);
            assert.ok(children.every(child => child.parent === parent && child.parentId === 1 && db.entry(child)));
            assert.equal(await db.children.count(), size);
            assert.equal(await db.parents.count(), 1);
          }), 8, size + 7, budgets.batchP95Ms, prepare));
      }
    }
  } finally {
    await drop();
  }
  return results;
}

module.exports = { cascadeRemovalWorkloads };
