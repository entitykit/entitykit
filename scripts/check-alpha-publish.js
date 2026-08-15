const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('check:publish-alpha must run through npm.');
const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'entitykit-publish-cache-'));

function dryRun(args) {
  const env = { ...process.env };
  delete env.npm_config_tag;
  env.npm_config_cache = cache;
  return spawnSync(
    process.execPath,
    [npmCli, 'publish', '--dry-run', '--loglevel=notice', ...args],
    { cwd: root, encoding: 'utf8', env },
  );
}

try {
  const plain = dryRun([]);
  const plainOutput = `${plain.stdout ?? ''}\n${plain.stderr ?? ''}`;
  if (plain.status === 0 || !plainOutput.includes('Refusing prerelease publication')) {
    throw new Error('A plain npm publish dry run was not rejected by the alpha guard.');
  }

  const alpha = dryRun(['--tag', 'alpha']);
  const alphaOutput = `${alpha.stdout ?? ''}\n${alpha.stderr ?? ''}`;
  if (alpha.status !== 0) {
    throw new Error(`Alpha publish dry run failed.\n${alphaOutput}`);
  }
  if (!/with tag alpha\b/.test(alphaOutput) || /with tag latest\b/.test(alphaOutput)) {
    throw new Error(`Alpha publish dry run did not prove the alpha tag.\n${alphaOutput}`);
  }

  process.stdout.write('ALPHA_PUBLISH_DRY_RUN_OK tag=alpha plain=blocked\n');
} finally {
  fs.rmSync(cache, { recursive: true, force: true });
}
