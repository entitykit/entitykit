const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { monitorEventLoopDelay } = require('node:perf_hooks');
const { qualificationTarget, qualificationSource, within } = require('../scripts/provider-qualification');
const { withBenchmarkContext } = require('./workload-model');
const { directDriver, seedWorkload } = require('./direct-driver');
const { ormWorkloads } = require('./orm-workloads');
const { resourceWorkloads, bookshopWorkloads } = require('./resource-workloads');
const { budgets, pairedReadBudgets } = require('./workload-measurement');
const { scalingWorkloads } = require('./scaling-workloads');
const { scalingStreamWorkloads } = require('./scaling-stream-workloads');
const { contextSetupWorkloads } = require('./context-setup-workloads');

async function main() {
  const provider = process.argv[2] ?? 'sqlite';
  const { target, cleanup } = qualificationTarget(provider, 'ENTITYKIT_BENCHMARK_DATABASE_URL');
  const source = qualificationSource(provider, target, 4);
  const counters = { queries: 0, maxParameters: 0 };
  const raw = directDriver(provider, target, counters);
  const rows = 2_000;
  const loopDelay = monitorEventLoopDelay({ resolution: 10 });
  loopDelay.enable();
  try {
    await raw.query('drop table if exists entitykit_benchmark_notes');
    await raw.query('drop table if exists entitykit_benchmark_records');
    await withBenchmarkContext(source, counters, db => db.database.ensureCreated());
    await seedWorkload(raw, provider, rows);
    loopDelay.reset();
    const results = await ormWorkloads(source, raw, provider, counters, rows);
    const expectedRows = Number((await raw.query('select count(*) as total from entitykit_benchmark_records'))[0].total);
    const { pool, resources } = await resourceWorkloads(source, counters, expectedRows);
    results.push(pool, ...await bookshopWorkloads(provider, target, counters));
    const scaling = await scalingWorkloads(source, raw, provider, counters);
    const streams = await scalingStreamWorkloads(source, provider, counters);
    results.push(...scaling.results, ...streams.results);
    const contextSetup = await contextSetupWorkloads(source, counters);
    await scaling.cleanup();
    const comparisons = pairedReadBudgets(results);
    const databaseVersion = String((await raw.query(provider === 'sqlite'
      ? 'select sqlite_version() as version' : 'select version() as version'))[0].version);
    const eventLoopMaxMs = loopDelay.max / 1_000_000;
    assert.ok(eventLoopMaxMs <= budgets.eventLoopMaxMs, 'Event-loop delay exceeded the qualification budget.');
    assert.ok(results.every(result => Number.isFinite(result.p95Ms) && result.p95Ms >= 0));
    const evidence = {
      schemaVersion: 1, generatedAt: new Date().toISOString(), provider,
      entityKitVersion: require('../package.json').version, node: process.version, databaseVersion,
      gitSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      workingTreeDirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
      environment: { platform: process.platform, architecture: process.arch, cpu: os.cpus()[0]?.model, cpuCount: os.cpus().length },
      parameters: { seedRows: rows, rowPayloadBytes: 192, warmups: 5, readSamples: 40, poolMaximum: 4 },
      measurement: { percentileMethod: 'nearest-rank', scalingSamples: 8,
        ormIncludesFreshContext: true, rawReusesConnection: true,
        databaseStorage: process.env.ENTITYKIT_BENCHMARK_STORAGE_LABEL ?? (provider === 'sqlite' ? 'temporary-file' : 'unspecified') },
      budgets, results, comparisons, contextSetup, scalingStreams: streams.resources,
      sqliteFastConsumerCancellation: streams.cancellation, resources: { ...resources, eventLoopMaxMs },
    };
    const directory = process.env.ENTITYKIT_BENCHMARK_OUTPUT_DIR ?? path.join(__dirname, '..', 'coverage', 'performance');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, `${provider}.json`), `${JSON.stringify(evidence, null, 2)}\n`);
    await raw.query('drop table entitykit_benchmark_notes');
    await raw.query('drop table entitykit_benchmark_records');
    console.log(`PERFORMANCE_QUALIFICATION_OK ${provider} workloads=${results.length}`);
  } finally {
    loopDelay.disable();
    await raw.dispose();
    await within(source.dispose(), 2_000, 'benchmark pool shutdown');
    cleanup();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
