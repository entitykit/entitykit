const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { DbContext } = require('@entitykit/core');
const { percentile } = require('./workload-measurement');

async function contextSetupWorkloads(source, counters) {
  const results = [];
  for (const count of [1, 10, 50, 100]) {
    let modelHooks = 0;
    const types = Array.from({ length: count }, (_, index) => {
      class SetupEntity {}
      Object.defineProperty(SetupEntity, 'name', { value: `SetupEntity${index}` });
      return SetupEntity;
    });
    class SetupContext extends DbContext {
      configure(options) {
        options.useDataSource(source).useDiagnostics(event => { if (event.kind === 'query') counters.queries += 1; });
      }
      model(model) {
        modelHooks += 1;
        for (const [index, type] of types.entries()) {
          model.entity(type, entity => {
            entity.toTable(`entitykit_setup_${index}`).hasKey('field0');
            for (let field = 0; field < 20; field += 1) entity.property(`field${field}`).hasColumnType('integer').isRequired();
          });
        }
      }
    }
    const latency = [];
    counters.queries = 0;
    for (let iteration = 0; iteration < 45; iteration += 1) {
      const start = performance.now();
      const db = SetupContext.create();
      assert.equal(db.changeTracker.entries().length, 0);
      await db.dispose();
      if (iteration >= 5) latency.push(performance.now() - start);
    }
    assert.equal(modelHooks, 45);
    assert.equal(counters.queries, 0);
    const result = { name: `context.setup-${count}-types`, samples: 40, warmups: 5, mappedTypes: count,
      fieldsPerType: 20, modelHooks, includesDisposal: true, maximumQueries: 0,
      p50Ms: percentile(latency, 0.5), p95Ms: percentile(latency, 0.95), p99Ms: percentile(latency, 0.99) };
    assert.ok(result.p95Ms <= 250, 'Context initialization exceeded its portable smoke budget.');
    results.push(result);
    console.log(`PERFORMANCE_SETUP_OK types=${count} p50=${result.p50Ms.toFixed(3)}ms hooks=${modelHooks}`);
  }
  return results;
}

module.exports = { contextSetupWorkloads };
