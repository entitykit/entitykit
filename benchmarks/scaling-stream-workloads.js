const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { OperationCanceledError } = require('@entitykit/core');
const { withScalingContext } = require('./scaling-model');
const { measure, budgets } = require('./workload-measurement');

/** Observe physical driver commands separately from application SQL diagnostics. */
async function observeDriverCommands(provider, work) {
  if (provider === 'sqlite') return await work(undefined);
  let prototype = provider === 'postgres' ? require('pg').Client.prototype : require('mysql2').Connection.prototype;
  // mysql2's regular and pooled connections inherit the same query owner.
  while (prototype && !Object.hasOwn(prototype, 'query')) prototype = Object.getPrototypeOf(prototype);
  assert.equal(typeof prototype?.query, 'function', 'Missing physical driver query instrumentation.');
  const original = prototype.query;
  const commands = { count: 0 };
  prototype.query = function (...args) { commands.count += 1; return original.apply(this, args); };
  try { return await work(commands); } finally { prototype.query = original; }
}

async function scalingStreamWorkloads(source, provider, counters) {
  const results = [];
  const resources = [];
  for (const size of [512, 4_000]) {
    for (const batchSize of [32, 256]) {
      global.gc();
      const before = process.memoryUsage();
      let peakHeap = before.heapUsed;
      let peakRss = before.rss;
      let maximumCommands = 0;
      await observeDriverCommands(provider, async commands => {
        results.push(await measure(`orm.fast-stream-${size}-batch${batchSize}`, counters, () => withScalingContext(source, counters, async db => {
          if (commands) commands.count = 0;
          let count = 0;
          for await (const child of db.children.asNoTracking().orderBy(row => row.id).take(size).stream({ batchSize })) {
            assert.ok(child.id > 0);
            count += 1;
            if (count % 256 === 0) {
              const memory = process.memoryUsage();
              peakHeap = Math.max(peakHeap, memory.heapUsed);
              peakRss = Math.max(peakRss, memory.rss);
            }
          }
          assert.equal(count, size);
          assert.equal(db.changeTracker.entries().length, 0);
          if (commands) {
            const expected = provider === 'postgres' ? Math.floor(size / batchSize) + 5 : 1;
            assert.equal(commands.count, expected, 'Unexpected physical stream command count.');
            maximumCommands = Math.max(maximumCommands, commands.count);
          }
        }), 8, 1, budgets.batchP95Ms, () => global.gc()));
      });
      global.gc();
      const retainedHeapBytes = Math.max(0, process.memoryUsage().heapUsed - before.heapUsed);
      const peakHeapGrowthBytes = Math.max(0, peakHeap - before.heapUsed);
      const rssGrowthBytes = Math.max(0, peakRss - before.rss);
      assert.ok(peakHeapGrowthBytes <= budgets.peakStreamHeapGrowthBytes, `Stream heap growth ${peakHeapGrowthBytes} exceeded ${budgets.peakStreamHeapGrowthBytes}.`);
      assert.ok(retainedHeapBytes <= budgets.retainedHeapBytes);
      assert.ok(rssGrowthBytes <= budgets.rssGrowthBytes);
      resources.push({ rows: size, batchSize, retainedTrackedEntities: 0, retainedHeapBytes, peakHeapGrowthBytes, rssGrowthBytes,
        maximumDriverCommands: provider === 'sqlite' ? null : maximumCommands, consumerYields: 0, forcedGcBetweenOperations: true });
    }
  }
  let cancellation;
  if (provider === 'sqlite') {
    await withScalingContext(source, counters, async db => {
      const controller = new AbortController();
      let timerFired = false;
      let consumed = 0;
      const start = performance.now();
      const timer = setTimeout(() => { timerFired = true; controller.abort('fast consumer qualification'); }, 0);
      try {
        await assert.rejects(async () => {
          for await (const row of db.database.connection.stream({
            text: 'with recursive numbers(n) as (select 1 union all select n+1 from numbers where n < 100000) select n from numbers', values: [],
          }, { batchSize: 32, signal: controller.signal })) {
            assert.ok(row.n > 0); consumed += 1;
          }
        }, OperationCanceledError);
      } finally { clearTimeout(timer); }
      assert.equal(timerFired, true);
      assert.ok(consumed > 0 && consumed < 100_000);
      assert.equal((await db.database.connection.query({ text: 'select 1 as healthy', values: [] })).rows[0].healthy, 1);
      cancellation = { timerFired, rowsConsumed: consumed, totalRows: 100_000, batchSize: 32, cancellationMs: performance.now() - start, consumerYields: 0 };
    });
  }
  return { results, resources, cancellation };
}

module.exports = { scalingStreamWorkloads };
