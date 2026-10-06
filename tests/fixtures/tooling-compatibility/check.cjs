const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = process.cwd();
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'entitykit-tooling-'));
const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const nextRequire = createRequire(path.join(root, 'examples/nextjs-postgres/package.json'));
const packageResolve = name => (name === '@next/eslint-plugin-next' ? nextRequire : require).resolve(`${name}/package.json`);
const packageRequire = name => createRequire(packageResolve(name));

function globs() {
  const plugin = packageRequire('@next/eslint-plugin-next');
  assert.equal(plugin('fast-glob/package.json').name, 'tinyglobby');
  const { getRootDirs } = plugin('./dist/utils/get-root-dirs');
  for (const dir of ['apps/shop/nested', 'apps/admin', 'other']) fs.mkdirSync(path.join(temporary, dir), { recursive: true });
  write(path.join(temporary, 'apps/file.ts'), '');
  process.chdir(temporary);
  assert.deepEqual(getRootDirs({ cwd: temporary, settings: {} }), [temporary]);
  const check = (rootDir, expected) => assert.deepEqual(
    getRootDirs({ cwd: temporary, settings: { next: { rootDir } } }).sort(), expected.sort(),
  );
  check('apps/*', ['apps/shop', 'apps/admin']);
  check('apps\\*', ['apps/shop', 'apps/admin']);
  check('apps/{shop,admin}', ['apps/shop', 'apps/admin']);
  check('apps/shop', ['apps/shop']);
  check('apps/**/nested', ['apps/shop/nested']);
  check(path.join(temporary, 'apps/*'), [path.join(temporary, 'apps/shop'), path.join(temporary, 'apps/admin')]);
  check(path.join(temporary, 'apps/shop'), [path.join(temporary, 'apps/shop')]);
  check(['apps/shop', 'other', null], ['apps/shop', 'other']);
  check('missing/*', []);
  check(`apps/${'{'.repeat(4000)}absent${'}'.repeat(4000)}`, []);
}

async function argumentsCheck() {
  assert.equal(packageRequire('@rushstack/ts-command-line')('argparse/package.json').version, '2.0.1');
  const { CommandLineParser, CommandLineAction } = require('@rushstack/ts-command-line');
  class Action extends CommandLineAction {
    constructor() {
      super({ actionName: 'check', summary: 'Check 100%', documentation: 'Keep %s literal' });
      this.name = this.defineStringParameter({ parameterLongName: '--name', argumentName: 'NAME', description: 'Name 100%', required: true });
      this.flag = this.defineFlagParameter({ parameterLongName: '--flag', description: 'Flag %s' });
      this.integer = this.defineIntegerParameter({ parameterLongName: '--number', argumentName: 'NUMBER', description: 'Integer' });
      this.list = this.defineStringListParameter({ parameterLongName: '--list', argumentName: 'ITEM', description: 'Repeated item' });
      this.choice = this.defineChoiceParameter({ parameterLongName: '--choice', alternatives: ['one', 'two'], description: 'Choice' });
      this.defineCommandLineRemainder({ description: 'Other arguments' });
    }
    async onExecuteAsync() {}
  }
  const create = () => {
    const parser = new CommandLineParser({ toolFilename: 'check', toolDescription: '100% complete', toolEpilog: 'Keep %.1000f literal' });
    const action = new Action(); parser.addAction(action); return { parser, action };
  };
  const { parser, action } = create();
  assert.match(parser.renderHelpText(), /100% complete/);
  assert.match(parser.renderHelpText(), /Keep %\.1000f literal/);
  await parser.executeWithoutErrorHandlingAsync(['check', '--name', 'EntityKit', '--flag', '--number', '-7', '--list', 'a', '--list', 'b', '--choice', 'two', '--', 'remaining']);
  assert.equal(action.name.value, 'EntityKit'); assert.equal(action.flag.value, true);
  assert.equal(action.integer.value, -7); assert.equal(action.choice.value, 'two');
  assert.deepEqual(action.list.values, ['a', 'b']); assert.deepEqual(action.remainder.values, ['--', 'remaining']);
  assert.match(action.renderHelpText(), /Keep %s literal/);
  assert.match(action.renderHelpText(), /Flag %s/);
  await assert.rejects(create().parser.executeWithoutErrorHandlingAsync(['check']), error => error.exitCode === 2);
  await assert.rejects(create().parser.executeWithoutErrorHandlingAsync(['check', '--name', 'valid', '--choice', 'invalid']), error => error.exitCode === 2);
  const cli = require.resolve('@microsoft/api-extractor/package.json');
  const bin = path.join(path.dirname(cli), 'bin/api-extractor');
  for (const args of [['--help'], ['run', '--help'], ['run', '--unknown-option']]) {
    const result = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.status, args.includes('--unknown-option') ? 2 : 0, result.stderr);
    assert.match(result.stdout + result.stderr, args.includes('--unknown-option') ? /unrecognized arguments/ : /API Extractor/);
  }
}

async function yaml() {
  const loader = packageRequire('@istanbuljs/load-nyc-config');
  assert.equal(loader('js-yaml/package.json').version, '4.3.2');
  write(path.join(temporary, 'package.json'), JSON.stringify({ name: 'nyc-fixture' }));
  write(path.join(temporary, 'base.yml'), 'include:\n  - "src/**/*.ts"\ncheck-coverage: true\n');
  write(path.join(temporary, '.nycrc.yaml'), 'extends: ./base.yml\nall: true\nexclude: "tests/**"\nbranches: 87\n');
  const { loadNycConfig } = require('@istanbuljs/load-nyc-config');
  const config = await loadNycConfig({ cwd: temporary });
  assert.deepEqual(config.include, ['src/**/*.ts']); assert.deepEqual(config.exclude, ['tests/**']);
  assert.equal(config.checkCoverage, true); assert.equal(config.all, true); assert.equal(config.branches, 87);
}

function installer() {
  const lock = require(path.join(root, 'package-lock.json'));
  assert.equal(Object.keys(lock.packages).some(name => /node_modules\/(?:braces|sprintf-js)$/.test(name)), false);
  const { patches } = require(path.join(root, 'config/tooling/compatibility-patches.json'));
  const { patchedSource, prepareTooling } = require(path.join(root, 'scripts/prepare-tooling'));
  const originals = [];
  const packageFile = name => path.join(temporary, 'node_modules', name, 'package.json');
  write(path.join(temporary, 'package.json'), '{}');
  for (const [name, version] of [['@rushstack/ts-command-line', '5.3.17'], ['@next/eslint-plugin-next', '16.3.8'], ['@istanbuljs/load-nyc-config', '1.1.0'], ['argparse', '2.0.1'], ['js-yaml', '4.3.2']]) {
    write(packageFile(name), JSON.stringify({ name, version }));
  }
  write(packageFile('fast-glob'), JSON.stringify({ name: 'tinyglobby', version: '0.2.17' }));
  for (const patch of patches) {
    let source = fs.readFileSync(path.join(path.dirname(packageResolve(patch.package)), patch.file), 'utf8');
    const applied = source;
    for (const { from, to } of [...patch.replacements].reverse()) source = source.replaceAll(to, from);
    assert.equal(crypto.createHash('sha256').update(source).digest('hex'), patch.before);
    assert.equal(patchedSource(source, patch), applied); assert.equal(patchedSource(applied, patch), applied);
    assert.throws(() => patchedSource(source + '\n', patch), /Unreviewed tooling source/);
    assert.throws(() => patchedSource(source, { ...patch, after: 'wrong' }), /checksum mismatch/);
    const file = path.join(path.dirname(packageFile(patch.package)), patch.file);
    write(file, source); originals.push({ file, source });
  }
  const last = originals.at(-1); write(last.file, last.source + '\n');
  assert.throws(() => prepareTooling(temporary), /Unreviewed tooling source/);
  for (const original of originals.slice(0, -1)) assert.equal(fs.readFileSync(original.file, 'utf8'), original.source);
  write(last.file, last.source); prepareTooling(temporary); prepareTooling(temporary);
  write(packageFile('@rushstack/ts-command-line'), JSON.stringify({ name: '@rushstack/ts-command-line', version: '5.3.18' }));
  assert.throws(() => prepareTooling(temporary), /Unreviewed tooling version/);
}

const checks = { globs, arguments: argumentsCheck, yaml, installer };
Promise.resolve().then(() => checks[process.argv[2]]()).then(() => {
  console.log(`TOOLING_CHECK_OK ${process.argv[2]}`);
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  process.chdir(root); fs.rmSync(temporary, { recursive: true, force: true });
});
