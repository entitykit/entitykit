const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mutationPlan } = require('./mutation-campaigns');

async function run() {
  const id = process.argv[2];
  const mode = process.argv[3];
  // Derive trusted configuration locally instead of executing matrix strings.
  const job = mutationPlan(process.cwd(), 'full').jobs.find(item => item.id === id);
  if (!job || !['full', 'pr', 'dry'].includes(mode)) throw new Error('Unknown mutation job or mode.');
  const options = require(path.resolve(job.config));
  const output = `coverage/mutation/${id}`;
  fs.mkdirSync('coverage/mutation', { recursive: true });
  const { Stryker } = await import('@stryker-mutator/core');
  const report = await new Stryker({
    ...options, configFile: false, mutate: job.mutate,
    // The complete original threshold is checked after every shard arrives.
    thresholds: job.shards > 1 ? { ...options.thresholds, break: 0 } : options.thresholds,
    incremental: true, force: mode !== 'pr', dryRunOnly: mode === 'dry',
    incrementalFile: `coverage/mutation-incremental/${id}.json`,
    htmlReporter: { fileName: `${output}.html` }, jsonReporter: { fileName: `${output}.json` },
    tempDirName: `temp/stryker-${id}`,
  }).runMutationTest();
  if (mode === 'dry') return;
  if (!report) throw new Error(`Missing mutation report for ${id}.`);
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  fs.writeFileSync(`${output}.result.json`, `${JSON.stringify({ ...job, commit, mode }, null, 2)}\n`);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
