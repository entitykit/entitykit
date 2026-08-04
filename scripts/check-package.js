const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const packageManifest = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
);
const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error('check:package must run through npm.');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  });
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
    throw new Error(`${command} ${args.join(' ')} failed.\n${output}`);
  }
  return result.stdout ?? '';
}

function runNpm(args, options = {}) {
  return run(process.execPath, [npmCli, ...args], options);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertTarballFiles(pack) {
  const files = new Map(pack.files.map(file => [file.path, file]));
  for (const required of [
    'dist/index.js',
    'dist/index.d.ts',
    'dist/cli/index.js',
    'dist/providers/mysql/index.js',
    'dist/providers/postgres/index.js',
    'dist/providers/sqlite/index.js',
    'package.json',
  ]) {
    assert(files.has(required), `Packed artifact is missing '${required}'.`);
  }
  assert(
    ![...files].some(([file]) =>
      file.startsWith('src/')
      || file.startsWith('tests/')
      || file.startsWith('dogfood/')),
    'Packed artifact contains source, tests, or dogfood files.',
  );
  assert(
    ![...files].some(([file]) => file.endsWith('.map')),
    'Packed artifact contains source maps without their source files.',
  );
  const cli = files.get('dist/cli/index.js');
  assert(Boolean(cli && (cli.mode & 0o111) !== 0), 'Packed CLI is not executable.');
}

function runPackagedCli(project) {
  const binary = path.join(
    project,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'entitykit.cmd' : 'entitykit',
  );
  if (process.platform !== 'win32') {
    return run(binary, ['--version', '--json'], {
      cwd: project,
      capture: true,
    });
  }
  const command = `"${binary}" --version --json`;
  return run(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', command], {
    cwd: project,
    capture: true,
  });
}

const temporaryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), 'entitykit-package-check-'),
);
try {
  const artifacts = path.join(temporaryRoot, 'artifacts');
  const npmCache = path.join(temporaryRoot, 'npm-cache');
  fs.mkdirSync(artifacts);
  const packResult = JSON.parse(runNpm([
    'pack', '--json',
    '--pack-destination', artifacts,
    '--cache', npmCache,
  ], { capture: true }));
  const packed = Array.isArray(packResult)
    ? packResult
    : Object.values(packResult);
  assert(Array.isArray(packed) && packed.length === 1, 'npm pack returned no artifact.');
  assertTarballFiles(packed[0]);

  const tarball = path.join(artifacts, packed[0].filename);
  const project = path.join(temporaryRoot, 'consumer');
  fs.cpSync(path.join(root, 'tests', 'fixtures', 'package-consumer'), project, {
    recursive: true,
  });
  runNpm([
    'install', '--ignore-scripts', '--no-audit', '--no-fund',
    '--cache', npmCache, tarball,
  ], { cwd: project });

  run(process.execPath, [
    path.join(project, 'node_modules', 'typescript', 'bin', 'tsc'),
    '-p', path.join(project, 'tsconfig.json'),
  ], { cwd: project });
  run(process.execPath, [path.join(project, 'runtime.cjs')], { cwd: project });
  run(process.execPath, [path.join(project, 'runtime.mjs')], { cwd: project });

  const cliOutput = runPackagedCli(project);
  const cliResult = JSON.parse(cliOutput);
  assert(
    cliResult.data?.version === packageManifest.version
      && cliResult.exitCode === 0,
    'Packaged CLI did not report the installed package version.',
  );

  process.stdout.write(
    `PACKAGE_CHECK_OK ${packed[0].filename} ${String(packed[0].entryCount)} files\n`,
  );
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
