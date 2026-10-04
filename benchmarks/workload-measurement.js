const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');

const budgets = {
  readP95Ms: 250, batchP95Ms: 2_000, checkoutP95Ms: 1_000,
  pairedReadExtraP95Ms: 10, retainedHeapBytes: 32 * 1024 * 1024,
  rssGrowthBytes: 128 * 1024 * 1024, streamMs: 10_000, eventLoopMaxMs: 2_000,
  peakStreamHeapGrowthBytes: 64 * 1024 * 1024,
};

function percentile(values, fraction) {
  assert.ok(values.length > 0 && values.every(value => Number.isFinite(value) && value >= 0));
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

async function measure(name, counters, operation, samples = 40, queryBudget = 1, maximumMs = budgets.readP95Ms) {
  for (let index = 0; index < 5; index += 1) await operation(index);
  const latency = [];
  let maximumQueries = 0;
  let maximumParameters = 0;
  for (let index = 0; index < samples; index += 1) {
    counters.queries = 0;
    counters.maxParameters = 0;
    const start = performance.now();
    await operation(index + 5);
    assert.ok(counters.queries > 0, `${name}: missing statement telemetry.`);
    latency.push(performance.now() - start);
    maximumQueries = Math.max(maximumQueries, counters.queries);
    maximumParameters = Math.max(maximumParameters, counters.maxParameters);
    await new Promise(resolve => setImmediate(resolve));
  }
  const result = { name, samples, p50Ms: percentile(latency, 0.5), p95Ms: percentile(latency, 0.95),
    p99Ms: percentile(latency, 0.99), maximumQueries, maximumParameters, queryBudget, maximumP95Ms: maximumMs };
  assert.ok(result.p95Ms <= maximumMs, `${name}: p95 ${result.p95Ms}ms exceeded ${maximumMs}ms.`);
  assert.ok(maximumQueries <= queryBudget, `${name}: ${maximumQueries} diagnostic statements exceeded ${queryBudget}.`);
  console.log(`PERFORMANCE_WORKLOAD_OK ${name} p95=${result.p95Ms.toFixed(3)}ms queries=${maximumQueries}`);
  return result;
}

function pairedReadBudgets(results) {
  return ['find', 'materialize', 'include'].map(area => {
    const raw = results.find(result => result.name === `raw.${area}`);
    const orm = results.find(result => result.name === `orm.${area}`);
    const extraP95Ms = orm.p95Ms - raw.p95Ms;
    assert.ok(extraP95Ms <= budgets.pairedReadExtraP95Ms, `${area}: extra p95 exceeded ${budgets.pairedReadExtraP95Ms}ms.`);
    return { area, rawP95Ms: raw.p95Ms, ormP95Ms: orm.p95Ms, extraP95Ms,
      p95Ratio: orm.p95Ms / Math.max(raw.p95Ms, 0.000001) };
  });
}

module.exports = { budgets, percentile, measure, pairedReadBudgets };
