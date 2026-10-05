const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const compiler = require.resolve('typescript/bin/tsc');

// Dependency order. `tsc -b` walks the project references itself, but naming the
// packages explicitly keeps the build deterministic and the failure legible.
const packages = ['core', 'sqlite', 'postgres', 'mysql', 'cli', 'testing', 'nestjs'];

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--clean')) {
  throw new Error('Usage: node scripts/build-package.js [--clean]');
}
if (args.includes('--clean')) {
  for (const name of packages) {
    const packageRoot = path.join(root, 'packages', name);
    fs.rmSync(path.join(packageRoot, 'dist'), { recursive: true, force: true });
    fs.rmSync(path.join(packageRoot, 'tsconfig.tsbuildinfo'), { force: true });
  }
} else {
  // TypeScript can consider an unchanged project up to date even when an
  // emitted file was deleted. Derive every expected output from its config,
  // including internal modules and declarations, before reusing build info.
  const configHost = { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined };
  for (const name of packages) {
    const packageRoot = path.join(root, 'packages', name);
    const config = ts.getParsedCommandLineOfConfigFile(
      path.join(packageRoot, 'tsconfig.json'), {}, configHost,
    );
    // Let the compiler below report configuration errors itself.
    if (!config || config.errors.length > 0) continue;
    const missing = config.fileNames.some(file =>
      ts.getOutputFileNames(config, file, !ts.sys.useCaseSensitiveFileNames)
        .some(output => !fs.existsSync(output)));
    if (missing) fs.rmSync(path.join(packageRoot, 'tsconfig.tsbuildinfo'), { force: true });
  }
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
