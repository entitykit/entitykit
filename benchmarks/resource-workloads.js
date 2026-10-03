const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { withBenchmarkContext } = require('./workload-model');
const { measure, budgets } = require('./workload-measurement');
const { qualificationSource } = require('../scripts/provider-qualification');
const { countedDataSource } = require('./counted-data-source');
const { BookshopStore } = require('../examples/bookshop/dist/bookshop-store');
const { resetShop } = require('../examples/bookshop/dist/qualification-fixture');
const { checkout } = require('../examples/bookshop/dist/checkout');
const { fulfillOrder } = require('../examples/bookshop/dist/fulfillment');
const { dispatchPending } = require('../examples/bookshop/dist/outbox-dispatch');

async function resourceWorkloads(source, counters, expectedRows) {
  assert.equal(typeof global.gc, 'function', 'Run performance qualification with --expose-gc.');
  global.gc();
  const before = process.memoryUsage();
  let heapPeak = before.heapUsed;
  let rssPeak = before.rss;
  let streamed = 0;
  const start = performance.now();
  await withBenchmarkContext(source, counters, async db => {
    for await (const row of db.records.asNoTracking().orderBy(record => record.id).stream({ batchSize: 32 })) {
      assert.ok(row.id > 0);
      streamed += 1;
      if (streamed % 128 === 0) {
        assert.equal(db.changeTracker.entries().length, 0);
        const memory = process.memoryUsage();
        heapPeak = Math.max(heapPeak, memory.heapUsed);
        rssPeak = Math.max(rssPeak, memory.rss);
        await new Promise(resolve => setImmediate(resolve));
      }
    }
    assert.equal(db.changeTracker.entries().length, 0);
  });
  const streamMs = performance.now() - start;
  assert.ok(heapPeak - before.heapUsed <= budgets.peakStreamHeapGrowthBytes, 'Stream heap growth exceeded its budget.');
  assert.equal(streamed, expectedRows);
  assert.ok(streamMs <= budgets.streamMs);
  for (let cycle = 0; cycle < 64; cycle += 1) {
    await withBenchmarkContext(source, counters, async db => {
      assert.equal((await db.records.orderBy(row => row.id).take(128).toArray()).length, 128);
      assert.equal(db.changeTracker.entries().length, 128);
    });
  }
  global.gc();
  const after = process.memoryUsage();
  const retainedHeapBytes = Math.max(0, after.heapUsed - before.heapUsed);
  const rssGrowthBytes = Math.max(0, rssPeak - before.rss, after.rss - before.rss);
  assert.ok(retainedHeapBytes <= budgets.retainedHeapBytes, 'Disposed contexts retained excessive heap.');
  assert.ok(rssGrowthBytes <= budgets.rssGrowthBytes, 'Resource workload exceeded its RSS growth budget.');
  const pool = await measure('orm.pool-pressure-32', counters, async () => Promise.all(Array.from({ length: 32 }, (_, index) =>
    withBenchmarkContext(source, counters, async db => { await db.records.findOrThrow(index + 1); }))), 8, 32);
  console.log(`PERFORMANCE_RESOURCES_OK streamed=${streamed} retainedHeap=${retainedHeapBytes} rssGrowth=${rssGrowthBytes}`);
  return { pool, resources: { streamed, batchSize: 32, streamMs, retainedTrackedEntities: 0, retainedHeapBytes,
    peakHeapGrowthBytes: Math.max(0, heapPeak - before.heapUsed), rssGrowthBytes, contextCycles: 64 } };
}

async function bookshopWorkloads(provider, target, counters) {
  const store = new BookshopStore(countedDataSource(qualificationSource(provider, target, 4), counters));
  let requests = 0;
  try {
    await resetShop(store, 2_000);
    const checkoutResult = await measure('bookshop.atomic-checkout', counters, async () => {
      await checkout(store, 'north-shop', 'buyer', { requestId: `performance-${requests++}`, sku: 'typescript-book', quantity: 1 });
    }, 40, 10, budgets.checkoutP95Ms);
    const deliveryResult = await measure('bookshop.durable-delivery', counters, async () => {
      assert.equal(await dispatchPending(store, event => fulfillOrder(store, event), 1), 1);
    }, 40, 10, budgets.checkoutP95Ms);
    const db = store.context('north-shop', 'auditor');
    try {
      assert.equal(await db.orders.count(), 45);
      assert.equal(await db.shipments.count(), 45);
      assert.equal(await db.deliveries.count(), 45);
    } finally { await db.dispose(); }
    return [checkoutResult, deliveryResult];
  } finally { await store.dispose(); }
}

module.exports = { resourceWorkloads, bookshopWorkloads };
