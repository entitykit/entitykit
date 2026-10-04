const fs = require('node:fs');
const path = require('node:path');
const { mutationFile } = require('./mutation-campaigns');

function mutationScore(files) {
  const counts = { Killed: 0, Timeout: 0, Survived: 0, NoCoverage: 0, Ignored: 0, RuntimeError: 0, CompileError: 0 };
  for (const file of Object.values(files)) {
    for (const mutant of file.mutants) {
      if (!Object.hasOwn(counts, mutant.status)) throw new Error(`Unfinished or unknown mutant status: ${mutant.status}`);
      counts[mutant.status] += 1;
    }
  }
  const detected = counts.Killed + counts.Timeout;
  const eligible = detected + counts.Survived + counts.NoCoverage;
  if (!eligible) throw new Error('Mutation campaign has no eligible mutants.');
  return { score: detected / eligible * 100, eligible, counts };
}

function checkMutationReports(plan, directory) {
  const campaigns = new Map();
  for (const job of plan.jobs) {
    const result = JSON.parse(fs.readFileSync(path.join(directory, `${job.id}.result.json`), 'utf8'));
    for (const key of ['id', 'campaign', 'config', 'shard', 'shards', 'threshold']) {
      if (result[key] !== job[key]) throw new Error(`Mismatched ${key} for ${job.id}.`);
    }
    if (result.commit !== plan.commit || result.mode !== plan.mode
      || JSON.stringify(result.mutate) !== JSON.stringify(job.mutate)) throw new Error(`Stale mutation result: ${job.id}`);
    const report = JSON.parse(fs.readFileSync(path.join(directory, `${job.id}.json`), 'utf8'));
    const expected = [...new Set(job.mutate.map(mutationFile))].sort();
    if (JSON.stringify(Object.keys(report.files).sort()) !== JSON.stringify(expected)) {
      throw new Error(`Missing or unexpected mutation source in ${job.id}.`);
    }
    const campaign = campaigns.get(job.campaign) ?? { id: job.campaign, threshold: job.threshold, files: {} };
    for (const [name, file] of Object.entries(report.files)) {
      if (Object.hasOwn(campaign.files, name)) throw new Error(`Duplicate mutation source: ${name}`);
      campaign.files[name] = file;
    }
    campaigns.set(job.campaign, campaign);
  }
  return [...campaigns.values()].map(campaign => {
    const metrics = mutationScore(campaign.files);
    if (metrics.score < campaign.threshold) {
      throw new Error(`${campaign.id} mutation score ${metrics.score.toFixed(2)}% is below ${campaign.threshold}%.`);
    }
    return { id: campaign.id, threshold: campaign.threshold, ...metrics };
  });
}

if (require.main === module) {
  const directory = process.argv[2] ?? 'coverage/mutation';
  const plan = JSON.parse(fs.readFileSync(path.join(directory, 'plan.json'), 'utf8'));
  const campaigns = checkMutationReports(plan, directory);
  const summary = { commit: plan.commit, mode: plan.mode, campaigns, deferred: plan.deferred, passed: true };
  fs.writeFileSync(path.join(directory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = campaigns.map(campaign => `| ${campaign.id} | ${campaign.score.toFixed(2)}% | ${campaign.eligible} | ${campaign.threshold}% |`);
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `Mutation qualification at \`${plan.commit}\` (${plan.mode}).\n\n| Campaign | Score | Eligible | Floor |\n| --- | --- | --- | --- |\n${rows.join('\n')}\n\n`
      + (plan.deferred.length ? 'Broad core mutation runs nightly and for every release.\n' : 'All mutation campaigns qualified with fresh results.\n'));
  }
  console.log(JSON.stringify(summary, null, 2));
}

module.exports = { mutationScore, checkMutationReports };
