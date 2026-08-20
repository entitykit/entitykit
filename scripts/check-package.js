// Acceptance for the six published tarballs: pack them, install them into a
// fresh consumer project by `file:` spec, and prove the scoped world works
// from the outside — types under Node16 and NodeNext, CommonJS and ESM
// runtimes against a real SQLite database, the installed CLI bin, and the one
// invariant the whole split rests on: a single @entitykit/core instance.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const packages = ['core', 'sqlite', 'postgres', 'mysql', 'cli', 'testing'];
const fixtures = path.join(root, 'tests', 'fixtures', 'package-consumer');
const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error('check:package must run through npm.');
}

function readManifest(...segments) {
  return JSON.parse(fs.readFileSync(path.join(...segments), 'utf8'));
}

const rootManifest = readManifest(root, 'package.json');

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

/** Every file an `exports` map promises, flattened to tarball-relative paths. */
function exportedFiles(exportsMap) {
  const targets = [];
  const visit = value => {
    if (typeof value === 'string') {
      targets.push(value.replace(/^\.\//u, ''));
      return;
    }
    if (value && typeof value === 'object') {
      Object.values(value).forEach(visit);
    }
  };
  visit(exportsMap);
  return [...new Set(targets)];
}

function assertManifest(name, manifest) {
  assert(manifest.name === `@entitykit/${name}`, `${name} is misnamed.`);
  assert(manifest.license === 'MIT', `${name} does not declare the MIT license.`);
  assert(
    Array.isArray(manifest.files) && manifest.files.length > 0,
    `${name} does not pin the files it publishes.`,
  );
  assert(
    exportedFiles(manifest.exports ?? {}).length > 0,
    `${name} publishes no export subpaths.`,
  );
  assert(
    manifest.publishConfig?.access === 'public'
      && manifest.publishConfig.tag === 'alpha',
    `${name} must publish publicly under the alpha dist-tag.`,
  );
  assert(
    typeof manifest.repository?.url === 'string'
      && manifest.repository.directory === `packages/${name}`
      && typeof manifest.homepage === 'string'
      && typeof manifest.bugs?.url === 'string'
      && typeof manifest.description === 'string',
    `${name} is missing the metadata npm shows on a package page.`,
  );
  if (name === 'cli') {
    // npm normalizes bin paths on publish; pinning the normalized spelling
    // keeps the shipped manifest byte-identical to the authored one.
    assert(
      manifest.bin?.entitykit === 'dist/index.js',
      'The published CLI bin path must already be npm-normalized.',
    );
  }
}

function assertTarball(name, manifest, pack) {
  const files = new Map(pack.files.map(file => [file.path, file]));
  for (const required of [
    'package.json', 'README.md', 'LICENSE',
    ...exportedFiles(manifest.exports ?? {}),
  ]) {
    assert(files.has(required), `${name} tarball is missing '${required}'.`);
  }
  const leaked = [...files.keys()].filter(file =>
    file.startsWith('src/')
    || file.startsWith('tests/')
    || file.startsWith('dogfood/')
    || file.endsWith('.map'));
  assert(
    leaked.length === 0,
    `${name} tarball ships sources, tests, or maps: ${leaked.join(', ')}.`,
  );
  if (name === 'cli') {
    const bin = files.get('dist/index.js');
    assert(Boolean(bin && (bin.mode & 0o111) !== 0), 'Packed CLI is not executable.');
  }
}

function writeConsumerManifest(project, tarballs) {
  const manifest = readManifest(project, 'package.json');
  const specs = Object.fromEntries(Object.entries(tarballs)
    .map(([name, tarball]) => [name, `file:${tarball}`]));
  manifest.dependencies = {
    ...specs,
    pg: rootManifest.devDependencies.pg,
    mysql2: rootManifest.devDependencies.mysql2,
    typescript: readManifest(root, 'packages', 'core', 'package.json')
      .dependencies.typescript,
  };
  // @entitykit/cli depends on @entitykit/core by version, which was never
  // published; the override redirects it to the same tarball the consumer
  // installs, which is also how one core copy stays one copy.
  manifest.overrides = specs;
  fs.writeFileSync(
    path.join(project, 'package.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

function typecheck(project, config) {
  run(process.execPath, [
    path.join(project, 'node_modules', 'typescript', 'bin', 'tsc'),
    '-p', path.join(project, config),
  ], { cwd: project });
}

function runInstalledCli(project, binary) {
  if (process.platform !== 'win32') {
    return run(binary, ['--version', '--json'], { cwd: project, capture: true });
  }
  return run(process.env.ComSpec ?? 'cmd.exe', [
    '/d', '/s', '/c', `"${binary}" --version --json`,
  ], { cwd: project, capture: true });
}

function assertCliVersion(output, version, how) {
  const result = JSON.parse(output);
  assert(
    result.data?.version === version && result.exitCode === 0,
    `The packaged CLI (${how}) did not report ${version}.`,
  );
}

runNpm(['run', 'build']);
process.stdout.write(`PACKAGE_BUILD_OK ${String(packages.length)} packages\n`);

const temporaryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), 'entitykit-package-check-'),
);
try {
  const artifacts = path.join(temporaryRoot, 'artifacts');
  fs.mkdirSync(artifacts);
  const packed = JSON.parse(runNpm([
    'pack', '--workspaces', '--json', '--pack-destination', artifacts,
  ], { capture: true }));
  assert(
    Array.isArray(packed) && packed.length === packages.length,
    `npm pack returned ${String(packed.length)} artifacts, expected ${String(packages.length)}.`,
  );

  const tarballs = {};
  for (const name of packages) {
    const manifest = readManifest(root, 'packages', name, 'package.json');
    const pack = packed.find(entry => entry.name === manifest.name);
    assert(pack !== undefined, `npm pack skipped ${manifest.name}.`);
    assertManifest(name, manifest);
    assertTarball(name, manifest, pack);
    tarballs[manifest.name] = path.join(artifacts, pack.filename);
    process.stdout.write(
      `PACKAGE_MANIFEST_OK ${manifest.name} ${String(pack.entryCount)} files\n`,
    );
  }

  const project = path.join(temporaryRoot, 'consumer');
  fs.cpSync(fixtures, project, { recursive: true });
  writeConsumerManifest(project, tarballs);
  // `--prefer-offline` keeps pg, mysql2 and typescript coming from the local
  // npm cache; the six packages themselves never touch a registry.
  runNpm([
    'install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline',
  ], { cwd: project });
  const installed = fs.readdirSync(path.join(project, 'node_modules', '@entitykit'));
  assert(
    installed.length === packages.length,
    `The consumer installed ${String(installed.length)} scoped packages.`,
  );
  process.stdout.write(
    `PACKAGE_INSTALL_OK ${installed.sort().join(' ')}\n`,
  );

  typecheck(project, 'tsconfig.json');
  process.stdout.write('PACKAGE_NODE16_TYPES_OK\n');
  typecheck(project, 'tsconfig.nodenext.json');
  process.stdout.write('PACKAGE_NODE_NEXT_TYPES_OK\n');

  run(process.execPath, [path.join(project, 'runtime.cjs')], { cwd: project });
  run(process.execPath, [path.join(project, 'runtime.mjs')], { cwd: project });
  run(process.execPath, [path.join(project, 'single-core.cjs')], { cwd: project });

  const version = readManifest(root, 'packages', 'cli', 'package.json').version;
  assertCliVersion(run(process.execPath, [
    path.join(project, 'node_modules', '@entitykit', 'cli', 'dist', 'index.js'),
    '--version', '--json',
  ], { cwd: project, capture: true }), version, 'dist entry');
  assertCliVersion(runInstalledCli(project, path.join(
    project, 'node_modules', '.bin',
    process.platform === 'win32' ? 'entitykit.cmd' : 'entitykit',
  )), version, 'installed bin');
  process.stdout.write(`PACKAGE_CLI_OK entitykit ${version}\n`);

  process.stdout.write(
    `PACKAGE_CHECK_OK ${String(packages.length)} packages ${version}\n`,
  );
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
