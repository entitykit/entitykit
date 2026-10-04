const fs = require('node:fs');
const path = require('node:path');

function mutationCampaigns(root = process.cwd()) {
  const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts;
  return scripts['test:mutation'].split(' && ').map(command => {
    const script = command.startsWith('npm run ') ? command.slice(8) : undefined;
    const config = /^stryker run (config\/stryker\/\S+\.cjs)$/u.exec(script ? scripts[script] : command)?.[1];
    if (!config) throw new Error(`Unknown mutation command: ${command}`);
    const id = script ? script.slice('test:mutation:'.length) : 'core';
    const options = require(path.join(root, config));
    const jest = require(path.join(root, options.jest.configFile));
    return { id, config, mutate: options.mutate, tests: jest.testMatch, threshold: options.thresholds.break };
  });
}

function mutationFile(pattern) {
  return pattern.replace(/:\d+-\d+$/u, '');
}

function shardMutationScope(patterns, count, readSource) {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('Mutation shard count must be a positive integer.');
  const files = new Map();
  for (const pattern of patterns) {
    const file = mutationFile(pattern);
    const entry = files.get(file) ?? { file, patterns: [], weight: 0 };
    entry.patterns.push(pattern);
    const range = /:(\d+)-(\d+)$/u.exec(pattern);
    entry.weight += range ? Number(range[2]) - Number(range[1]) + 1 : readSource(file).split('\n').length;
    files.set(file, entry);
  }
  const shards = Array.from({ length: Math.min(count, files.size) }, () => ({ mutate: [], weight: 0 }));
  for (const entry of [...files.values()].sort((a, b) => b.weight - a.weight || a.file.localeCompare(b.file))) {
    const shard = shards.reduce((smallest, item) => item.weight < smallest.weight ? item : smallest);
    shard.mutate.push(...entry.patterns);
    shard.weight += entry.weight;
  }
  return shards.map(shard => shard.mutate.sort());
}

function affectedCampaigns(campaigns, changedFiles) {
  const scoped = campaigns.filter(campaign => campaign.id !== 'core');
  // A shared SDK, fixture, toolchain or configuration change may affect every
  // campaign through imports. Conservatively rerun all scoped campaigns.
  const shared = changedFiles.some(file => /^(?:packages\/|config\/|scripts\/|tests\/(?:support|fixtures)\/)/u.test(file)
    || /^(?:package(?:-lock)?\.json|tsconfig.*\.json)$/u.test(file)
    || (file.startsWith('tests/') && !file.endsWith('.test.ts')));
  if (shared) return scoped;
  return scoped.filter(campaign => changedFiles.some(file => campaign.tests.includes(`<rootDir>/${file}`)));
}

function mutationPlan(root, mode, changedFiles = []) {
  if (!['full', 'pr'].includes(mode)) throw new Error(`Unknown mutation mode: ${mode}`);
  const campaigns = mutationCampaigns(root);
  const selected = mode === 'full' ? campaigns : affectedCampaigns(campaigns, changedFiles);
  const jobs = selected.flatMap(campaign => {
    const scopes = campaign.id === 'core'
      ? shardMutationScope(campaign.mutate, 8, file => fs.readFileSync(path.join(root, file), 'utf8'))
      : [campaign.mutate];
    return scopes.map((mutate, shard) => ({
      id: scopes.length === 1 ? campaign.id : `${campaign.id}-${shard + 1}`,
      campaign: campaign.id, config: campaign.config, mutate,
      shard: shard + 1, shards: scopes.length, threshold: campaign.threshold,
    }));
  });
  return { mode, jobs, deferred: mode === 'pr' ? ['core'] : [] };
}

module.exports = { mutationCampaigns, mutationFile, shardMutationScope, affectedCampaigns, mutationPlan };
