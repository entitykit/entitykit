// Publish-path acceptance. Every workspace must dry-run cleanly under the
// selected public dist-tag and be refused without it; the repository root stays
// unpublishable. Nothing here ever publishes: --dry-run on every invocation.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { releasePolicy } = require('./release-channel-policy');

const root = path.resolve(__dirname, '..');
const packages = ['core', 'sqlite', 'postgres', 'mysql', 'cli', 'testing', 'nestjs'];
const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error('check:publish must run through npm.');
}
const policy = releasePolicy(readManifest('package.json').version);
const tag = policy.targetTag;
const prefix = policy.channel.toUpperCase();

function readManifest(...segments) {
  return JSON.parse(fs.readFileSync(path.join(root, ...segments), 'utf8'));
}

function dryRun(args, acceptance = false) {
  const env = { ...process.env };
  delete env.ENTITYKIT_ALPHA_DRY_RUN;
  if (acceptance) env.ENTITYKIT_RELEASE_DRY_RUN = 'accept';
  else delete env.ENTITYKIT_RELEASE_DRY_RUN;
  // A tag inherited from the outer npm invocation would mask the plain path.
  delete env.npm_config_tag;
  const result = spawnSync(
    process.execPath,
    [npmCli, 'publish', '--dry-run', '--loglevel=notice', ...args],
    { cwd: root, encoding: 'utf8', env },
  );
  return {
    status: result.status,
    output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
  };
}

function assert(condition, message, run) {
  if (!condition) {
    throw new Error(`${message}\n${run.output}`);
  }
}

for (const name of packages) {
  const workspace = `packages/${name}`;
  const manifest = readManifest(workspace, 'package.json');

  const plain = dryRun(['--workspace', workspace]);
  assert(
    plain.status !== 0 && plain.output.includes('publication of'),
    `A plain npm publish dry run of ${manifest.name} was not rejected by the guard.`,
    plain,
  );
  assert(
    plain.output.includes(manifest.name),
    `The guard did not name ${manifest.name} as the package it refused.`,
    plain,
  );

  const directAlpha = dryRun(['--workspace', workspace, '--tag', tag]);
  assert(
    directAlpha.status !== 0
      && directAlpha.output.includes('working-copy publication is disabled'),
    `An unmarked ${tag} publish dry run of ${manifest.name} bypassed the guard.`,
    directAlpha,
  );

  const alpha = dryRun(['--workspace', workspace, '--tag', tag], true);
  assert(alpha.status === 0, `${prefix} publish dry run of ${manifest.name} failed.`, alpha);
  assert(
    alpha.output.includes(`with tag ${tag} and public access`),
    `${prefix} publish dry run of ${manifest.name} did not prove the ${tag} tag.`,
    alpha,
  );
  assert(
    alpha.output.includes(`${manifest.name}@${manifest.version}`),
    `${prefix} publish dry run did not report ${manifest.name}@${manifest.version}.`,
    alpha,
  );
  process.stdout.write(
    `${prefix}_PUBLISH_PACKAGE_OK ${manifest.name}@${manifest.version} `
    + `tag=${tag} direct=blocked acceptance=dry-run\n`,
  );
}

// The root is private, so npm's workspace publish path must skip it outright.
// --ignore-scripts keeps this run from re-packing through the root prepack.
const rootManifest = readManifest('package.json');
const rootRun = dryRun([
  '--workspace', 'packages/testing', '--include-workspace-root',
  '--ignore-scripts', '--tag', tag,
]);
if (rootManifest.private !== true) {
  throw new Error('The repository root must stay private.');
}
assert(
  new RegExp(`Skipping workspace[^\\n]*${rootManifest.name}[^\\n]*private`, 'u')
    .test(rootRun.output),
  'npm did not refuse to publish the private repository root.',
  rootRun,
);
assert(
  !new RegExp(`\\+ ${rootManifest.name}@`, 'u').test(rootRun.output),
  'npm reported the private repository root as published.',
  rootRun,
);

process.stdout.write(
  `${prefix}_PUBLISH_DRY_RUN_OK packages=${String(packages.length)} `
  + `tag=${tag} direct=blocked acceptance=dry-run root=private\n`,
);
