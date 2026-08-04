const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
const compiler = require.resolve('typescript/bin/tsc');

fs.rmSync(output, { recursive: true, force: true });
const result = spawnSync(
  process.execPath,
  [compiler, '-p', path.join(root, 'tsconfig.build.json')],
  { cwd: root, stdio: 'inherit' },
);
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

fs.chmodSync(path.join(output, 'cli', 'index.js'), 0o755);
