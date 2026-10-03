const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function installHistoricalPackages(consumer, fixture, root, npmCli) {
  if (!npmCli) throw new Error('Run migration compatibility through npm.');
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const dependencies = Object.fromEntries(Object.entries(fixture.packages).map(([name, value]) => [name, value.version]));
  for (const name of ['pg', 'mysql2', 'typescript']) dependencies[name] = lock.packages[`node_modules/${name}`].version;
  fs.mkdirSync(consumer, { recursive: true });
  fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({
    name: 'entitykit-historical-consumer', private: true, version: '1.0.0', dependencies,
  }));
  const installed = spawnSync(process.execPath, [npmCli, 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline'], {
    cwd: consumer, encoding: 'utf8', timeout: 120_000,
  });
  if (installed.status !== 0) throw new Error('Historical package installation failed.');
  validateHistoricalPackages(consumer, fixture);
}

function validateHistoricalPackages(consumer, fixture) {
  const lock = JSON.parse(fs.readFileSync(path.join(consumer, 'package-lock.json'), 'utf8'));
  for (const [name, expected] of Object.entries(fixture.packages)) {
    const installed = lock.packages[`node_modules/${name}`];
    if (installed?.version !== expected.version || installed.integrity !== expected.integrity) {
      throw new Error(`Historical artifact differs from the recorded release: ${name}.`);
    }
  }
}

module.exports = { installHistoricalPackages, validateHistoricalPackages };
