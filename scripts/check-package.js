// Acceptance for the seven published tarballs: pack them, install them into a
// fresh consumer project by `file:` spec, and prove the scoped world works
// from the outside — types under Node16 and NodeNext, CommonJS and ESM
// runtimes against a real SQLite database, the installed CLI bin, and the one
// invariant the whole split rests on: a single @entitykit/core instance.
//
// The consumer install is deliberately unassisted — no `overrides`, no
// `--force`, no `--legacy-peer-deps` — so the single-core result is what the
// authored dependency graph produces rather than what this script arranged.
// The last stage skews the CLI's core peer and proves npm refuses the pair.
//
// Set ENTITYKIT_PACKAGE_OUTPUT_DIR to keep the tarballs: they are packed into
// that directory, accepted there, and left behind when this run finishes, so a
// caller that ships them ships the exact bytes every stage below ran against.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const packages = ['core', 'sqlite', 'postgres', 'mysql', 'cli', 'testing', 'nestjs'];
const fixtures = path.join(root, 'tests', 'fixtures', 'package-consumer');
// A core version no tarball here carries, standing in for the skew a real
// consumer hits when it upgrades core and leaves the CLI behind.
const skewedCoreVersion = '0.1.0-alpha.999';
const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error('check:package must run through npm.');
}
const retained = process.env.ENTITYKIT_PACKAGE_OUTPUT_DIR
  ? path.resolve(root, process.env.ENTITYKIT_PACKAGE_OUTPUT_DIR)
  : undefined;

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

/** npm run whose failure is the point: the exit status is data, not an error. */
function attemptNpm(args, options = {}) {
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd: options.cwd ?? root,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/** A tarball's SHA-512 SRI, spelled the way npm spells `dist.integrity`. */
function integrityOf(tarball) {
  const digest = createHash('sha512').update(fs.readFileSync(tarball)).digest('base64');
  return `sha512-${digest}`;
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
  // The seven `file:` specs and their external peers. Every package peers on
  // @entitykit/core at an exact version, so the root-level core the consumer
  // installs is the only copy that satisfies all five peers — no `overrides`
  // entry puts a thumb on that scale.
  manifest.dependencies = {
    ...specs,
    pg: rootManifest.devDependencies.pg,
    mysql2: rootManifest.devDependencies.mysql2,
    '@nestjs/common': rootManifest.devDependencies['@nestjs/common'],
    '@nestjs/core': rootManifest.devDependencies['@nestjs/core'],
    '@nestjs/testing': rootManifest.devDependencies['@nestjs/testing'],
    'reflect-metadata': rootManifest.devDependencies['reflect-metadata'],
    rxjs: rootManifest.devDependencies.rxjs,
    typescript: readManifest(root, 'packages', 'core', 'package.json')
      .dependencies.typescript,
  };
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

/**
 * The published CLI tarball, unpacked and repacked with its core peer moved to
 * a version no sibling carries. `tar -xzf` is the same extractor npm uses to
 * install a tarball and ships with macOS, Linux, and Windows 10 and newer.
 */
function repackSkewedCli(directory, tarball) {
  fs.mkdirSync(directory);
  run('tar', ['-xzf', tarball, '-C', directory]);
  const unpacked = path.join(directory, 'package');
  const manifestPath = path.join(unpacked, 'package.json');
  const manifest = readManifest(manifestPath);
  assert(
    manifest.peerDependencies?.['@entitykit/core'] !== undefined
      && manifest.dependencies === undefined,
    'The packed CLI must peer on @entitykit/core rather than depend on it.',
  );
  manifest.peerDependencies['@entitykit/core'] = skewedCoreVersion;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const packed = JSON.parse(runNpm([
    'pack', unpacked, '--ignore-scripts', '--json',
    '--pack-destination', directory,
  ], { capture: true }));
  return path.join(directory, packed[0].filename);
}

/**
 * A CLI whose core peer cannot be satisfied must be refused at install time.
 * The alternative — npm nesting a second core under the CLI — type-checks,
 * runs, and then splits core's module-level WeakMaps in half at the worst
 * possible moment, so the package graph has to be what rules it out.
 */
function assertSkewRejected(project, coreTarball, cliTarball) {
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'package.json'), `${JSON.stringify({
    name: 'entitykit-package-skew-consumer',
    version: '1.0.0',
    private: true,
    dependencies: {
      '@entitykit/core': `file:${coreTarball}`,
      '@entitykit/cli': `file:${cliTarball}`,
    },
  }, null, 2)}\n`);

  // Exactly the install a consumer types: no --force, no --legacy-peer-deps.
  const attempt = attemptNpm([
    'install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline',
  ], { cwd: project });
  assert(
    attempt.status !== 0,
    `npm installed @entitykit/cli beside a core it does not accept.\n${attempt.output}`,
  );
  assert(
    attempt.output.includes('ERESOLVE')
      && attempt.output.includes(`peer @entitykit/core@"${skewedCoreVersion}"`),
    'npm rejected the skewed pair for some reason other than the core peer.'
    + `\n${attempt.output}`,
  );
  const nested = path.join(
    project, 'node_modules', '@entitykit', 'cli', 'node_modules', '@entitykit',
  );
  assert(
    !fs.existsSync(nested),
    'npm nested a second @entitykit/core under the CLI instead of refusing.',
  );
}

runNpm(['run', 'build']);
process.stdout.write(`PACKAGE_BUILD_OK ${String(packages.length)} packages\n`);

const temporaryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), 'entitykit-package-check-'),
);
try {
  // One pack for the whole run. Retained or not, these are the files every
  // stage below installs, type-checks, runs and skews — there is no second
  // pack anywhere for the retained set to disagree with.
  const artifacts = retained ?? path.join(temporaryRoot, 'artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspaceArguments = packages.flatMap(name => [
    '--workspace', `packages/${name}`,
  ]);
  const packed = JSON.parse(runNpm([
    'pack', ...workspaceArguments, '--json', '--pack-destination', artifacts,
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
  // npm cache; the seven EntityKit packages themselves never touch a registry.
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
  run(process.execPath, [path.join(root, 'scripts', 'check-deprecated-exports.mjs'), project]);
  typecheck(project, 'tsconfig.predicates.json');
  run(process.execPath, [path.join(root, 'scripts', 'check-predicate-lint.mjs'), project]);

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

  assertSkewRejected(
    path.join(temporaryRoot, 'skew-consumer'),
    tarballs['@entitykit/core'],
    repackSkewedCli(path.join(temporaryRoot, 'skew'), tarballs['@entitykit/cli']),
  );
  process.stdout.write(
    'PACKAGE_SKEW_REJECTED_OK @entitykit/cli peer '
    + `@entitykit/core@${skewedCoreVersion} ERESOLVE\n`,
  );

  if (retained !== undefined) {
    // Printed last, so the audit trail is only ever emitted for a set that
    // cleared every stage. A caller uploading this directory by glob would
    // ship a stray tarball too, so the directory has to hold these seven alone.
    const kept = fs.readdirSync(retained).filter(file => file.endsWith('.tgz')).sort();
    const accepted = Object.values(tarballs).map(tarball => path.basename(tarball)).sort();
    assert(
      kept.join(' ') === accepted.join(' '),
      `${retained} holds ${kept.join(' ')}, not the accepted ${accepted.join(' ')}.`,
    );
    process.stdout.write(
      `PACKAGE_ARTIFACTS_RETAINED_OK ${retained} ${String(kept.length)} tarballs\n`,
    );
    for (const name of packages) {
      process.stdout.write(
        `PACKAGE_INTEGRITY @entitykit/${name} `
        + `${integrityOf(tarballs[`@entitykit/${name}`])}\n`,
      );
    }
  }

  process.stdout.write(
    `PACKAGE_CHECK_OK ${String(packages.length)} packages ${version}\n`,
  );
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
