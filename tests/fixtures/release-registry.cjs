// A registry state machine used only behind a disposable PATH shim. The real
// workflow shell runs unchanged; this executable never contacts a registry.
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const file = process.env.ENTITYKIT_RELEASE_TEST_STATE;
if (!file) throw new Error('Missing disposable registry state.');
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
const args = process.argv.slice(2);
state.calls.push(args);
const save = () => fs.writeFileSync(file, JSON.stringify(state));
const fail = (code, message = '') => {
  save();
  console.error(`npm error code ${code}\n${message}`);
  process.exit(1);
};
const command = args[0] === 'dist-tag' ? 'tag' : args[0];
const spec = command === 'tag' ? args[2] : args[1];
const failure = state.failures[`${command}:${spec}`];
if (failure && (failure.remaining === undefined || failure.remaining > 0)) {
  if (failure.remaining !== undefined) failure.remaining -= 1;
  fail(failure.code, failure.message);
}

if (command === 'view') {
  const value = args[2] === 'version' ? state.tags[spec] : state.integrities[spec];
  if (value === undefined) fail('E404');
  console.log(value);
} else if (command === 'publish') {
  if (!args.includes('--provenance')) fail('TEST_MISSING_PROVENANCE');
  const tag = args[args.indexOf('--tag') + 1];
  if (tag !== 'alpha-candidate' && tag !== 'stable-candidate') fail('TEST_PUBLIC_TAG_WRITE');
  const manifest = JSON.parse(execFileSync('tar', ['-xzOf', spec, 'package/package.json'], { encoding: 'utf8' }));
  const identity = `${manifest.name}@${manifest.version}`;
  if (state.integrities[identity] !== undefined) fail('TEST_OVERWRITE');
  state.integrities[identity] = `sha512-${createHash('sha512').update(fs.readFileSync(spec)).digest('base64')}`;
  state.tags[`${manifest.name}@${tag}`] = manifest.version;
} else if (command === 'tag' && args[1] === 'add') {
  if (state.integrities[spec] === undefined) fail('TEST_ABSENT_VERSION');
  const separator = spec.lastIndexOf('@');
  state.tags[`${spec.slice(0, separator)}@${args[3]}`] = spec.slice(separator + 1);
} else fail('TEST_UNSUPPORTED_COMMAND', args.join(' '));
save();
