const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const compiler = require.resolve('typescript/bin/tsc');

// Dependency order. `tsc -b` walks the project references itself, but naming the
// packages explicitly keeps the build deterministic and the failure legible.
const packages = ['core', 'sqlite', 'postgres', 'mysql', 'cli', 'testing', 'nestjs'];

for (const name of packages) {
  const packageRoot = path.join(root, 'packages', name);
  fs.rmSync(path.join(packageRoot, 'dist'), { recursive: true, force: true });
  fs.rmSync(path.join(packageRoot, 'tsconfig.tsbuildinfo'), { force: true });
}

const result = spawnSync(
  process.execPath,
  [compiler, '-b', ...packages.map(name => path.join(root, 'packages', name))],
  { cwd: root, stdio: 'inherit' },
);
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

// Only the CLI package ships an executable entry point.
fs.chmodSync(path.join(root, 'packages', 'cli', 'dist', 'index.js'), 0o755);
