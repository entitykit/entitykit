const crypto = require('node:crypto');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const { patches } = require('../config/tooling/compatibility-patches.json');

const hash = source => crypto.createHash('sha256').update(source).digest('hex');

function patchedSource(source, patch) {
  const actual = hash(source);
  if (actual === patch.after) return source;
  if (actual !== patch.before) throw new Error(`Unreviewed tooling source: ${patch.package}/${patch.file}`);
  let output = source;
  for (const { from, to, count } of patch.replacements) {
    if (output.split(from).length - 1 !== count) throw new Error(`Invalid tooling patch: ${patch.file}`);
    output = output.replaceAll(from, to);
  }
  if (hash(output) !== patch.after) throw new Error(`Tooling patch checksum mismatch: ${patch.file}`);
  return output;
}

function prepareTooling(root = path.resolve(__dirname, '..')) {
  const rootRequire = createRequire(path.join(root, 'package.json'));
  const nextRequire = createRequire(path.join(root, 'examples/nextjs-postgres/package.json'));
  const resolveParent = name => name === '@next/eslint-plugin-next' ? nextRequire : rootRequire;
  const loadPackage = (resolve, name) => {
    const file = resolve.resolve(`${name}/package.json`);
    return { file, manifest: JSON.parse(fs.readFileSync(file, 'utf8')) };
  };
  const expected = [
    ['@next/eslint-plugin-next', '16.3.8', 'fast-glob', 'tinyglobby', '0.2.17'],
    ['@rushstack/ts-command-line', '5.3.17', 'argparse', 'argparse', '2.0.1'],
    ['@istanbuljs/load-nyc-config', '1.1.0', 'js-yaml', 'js-yaml', '4.3.2'],
  ];
  for (const [parent, parentVersion, dependency, name, version] of expected) {
    const { file, manifest: parentManifest } = loadPackage(resolveParent(parent), parent);
    if (parentManifest.version !== parentVersion) throw new Error(`Unreviewed tooling version: ${parent}`);
    const parentRequire = createRequire(file);
    const { manifest } = loadPackage(parentRequire, dependency);
    if (manifest.name !== name || manifest.version !== version) {
      throw new Error(`Unreviewed tooling replacement: ${parent} -> ${dependency}`);
    }
  }
  // Validate every source before writing any of the compatibility patches.
  const plan = patches.map(patch => {
    const { file: manifestPath, manifest } = loadPackage(resolveParent(patch.package), patch.package);
    if (manifest.version !== patch.version) throw new Error(`Unreviewed tooling version: ${patch.package}`);
    const file = path.join(path.dirname(manifestPath), patch.file);
    const source = fs.readFileSync(file, 'utf8');
    return { file, source, output: patchedSource(source, patch) };
  });
  for (const { file, source, output } of plan) if (source !== output) fs.writeFileSync(file, output);
  console.log('TOOLING_COMPATIBILITY_OK pinned argument parsing and Next root-directory globbing');
}

if (require.main === module) prepareTooling();
module.exports = { patchedSource, prepareTooling };
