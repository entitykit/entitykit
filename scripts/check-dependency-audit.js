const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { evaluateAudits } = require('./dependency-audit-policy');

const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const family = ['core', 'sqlite', 'postgres', 'mysql', 'cli', 'testing', 'nestjs'];
if (!process.env.npm_execpath) throw new Error('Run through npm run check:security.');

function audit(args) {
  const result = spawnSync(process.execPath, [process.env.npm_execpath, 'audit', '--json', ...args], {
    cwd: root, encoding: 'utf8', timeout: 90_000, maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || ![0, 1].includes(result.status)) {
    throw new Error(`npm audit failed: ${result.error?.message ?? result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

const runtime = {
  packages: audit(['--omit=dev', ...family.map(name => `--workspace=packages/${name}`)]),
  examples: audit(['--omit=dev', '--workspaces']),
};
const full = audit([]);
const policy = read('docs/security-tooling-review.json');
const errors = evaluateAudits(runtime, full, read('package-lock.json'), policy);
if (errors.length) throw new Error(`Dependency security gate failed:\n${errors.join('\n')}`);
console.log('SECURITY_RUNTIME_OK seven packages and all examples: zero known advisories');
if (policy.reviews.length === 0) console.log('SECURITY_TOOLING_OK zero known advisories; no exceptions');
for (const review of policy.reviews) console.log(`SECURITY_TOOLING_OK reviewed ${review.advisory} until ${review.expires}`);
