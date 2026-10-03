const assert = require('node:assert/strict');
const { parameter } = require('./direct-driver');
const { BenchmarkRecord, withBenchmarkContext } = require('./workload-model');
const { measure, budgets } = require('./workload-measurement');

async function ormWorkloads(source, raw, provider, counters, rows) {
  const results = [];
  results.push(await measure('raw.find', counters, async index => {
    const found = await raw.query(`select id, value, version from entitykit_benchmark_records where id = ${parameter(provider, 1)}`, [index % rows + 1]);
    assert.equal(found.length, 1);
  }));
  results.push(await measure('orm.find', counters, async index => withBenchmarkContext(source, counters, async db => {
    assert.equal((await db.records.findOrThrow(index % rows + 1)).id, index % rows + 1);
    assert.equal(db.changeTracker.entries().length, 1);
  })));
  results.push(await measure('raw.materialize', counters, async () => {
    assert.equal((await raw.query('select id, value, version from entitykit_benchmark_records order by id limit 128')).length, 128);
  }));
  results.push(await measure('orm.materialize', counters, async () => withBenchmarkContext(source, counters, async db => {
    assert.equal((await db.records.orderBy(row => row.id).take(128).toArray()).length, 128);
    assert.equal(db.changeTracker.entries().length, 128);
  })));
  results.push(await measure('orm.no-tracking', counters, async () => withBenchmarkContext(source, counters, async db => {
    assert.equal((await db.records.asNoTracking().orderBy(row => row.id).take(128).toArray()).length, 128);
    assert.equal(db.changeTracker.entries().length, 0);
  })));
  results.push(await measure('raw.include', counters, async () => {
    const records = await raw.query('select id, value, version from entitykit_benchmark_records order by id limit 16');
    const notes = await raw.query(`select id, record_id, value from entitykit_benchmark_notes where record_id in (${records.map((row, index) => parameter(provider, index + 1)).join(', ')})`, records.map(row => row.id));
    assert.equal(notes.length, 32);
    assert.ok(records.map(row => ({ ...row, notes: notes.filter(note => note.record_id === row.id) })).every(row => row.notes.length === 2));
  }, 40, 2));
  results.push(await measure('orm.include', counters, async () => withBenchmarkContext(source, counters, async db => {
    const records = await db.records.orderBy(row => row.id).take(16).include(row => row.notes).toArray();
    assert.equal(records.length, 16);
    assert.ok(records.every(row => row.notes.length === 2));
  }), 40, 2));
  results.push(await measure('orm.tracked-save', counters, async index => withBenchmarkContext(source, counters, async db => {
    const record = await db.records.findOrThrow(1);
    const version = record.version;
    record.value = `tracked-${index}`;
    await db.saveChanges();
    assert.equal(record.version, version + 1);
  }), 40, 3));
  let batchId = rows + 1;
  results.push(await measure('orm.batch-save-64', counters, async () => withBenchmarkContext(source, counters, async db => {
    for (let index = 0; index < 64; index += 1) db.records.add(Object.assign(new BenchmarkRecord(), { id: batchId++, value: 'batched save' }));
    assert.equal(await db.saveChanges(), 64);
  }), 8, 1, budgets.batchP95Ms));
  results.push(await measure('orm.upsert-64', counters, async () => withBenchmarkContext(source, counters, async db => {
    const records = Array.from({ length: 64 }, (_, index) => Object.assign(new BenchmarkRecord(), { id: index + 2, value: 'upsert batch' }));
    assert.equal(await db.records.upsert(records), 64);
  }), 8, 1, budgets.batchP95Ms));
  assert.ok(results.every(result => result.maximumParameters <= 192), 'Workload parameter budget exceeded.');
  return results;
}

module.exports = { ormWorkloads };
