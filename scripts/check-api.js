const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { extractApiContract } = require('./extract-api-contract');

const root = path.resolve(__dirname, '..');
const family = ['core', 'sqlite', 'postgres', 'mysql', 'cli', 'testing', 'nestjs'];
const accept = process.argv.includes('--accept');
const reports = path.join(root, 'docs', 'api');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'entitykit-api-'));
const exportsBaseline = {};
fs.mkdirSync(reports, { recursive: true });

function canonical(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonical);
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

try {
  for (const name of family) {
    const project = path.join(root, 'packages', name);
    const packageJsonFullPath = path.join(project, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(packageJsonFullPath, 'utf8'));
    exportsBaseline[manifest.name] = { type: manifest.type, exports: manifest.exports, bin: manifest.bin };
    for (const [subpath, definition] of Object.entries(manifest.exports)) {
      if (subpath === './experimental' || subpath === './package.json') continue;
      if (!definition?.types) throw new Error(`Missing public declarations for ${manifest.name}/${subpath}.`);
      const entry = path.resolve(project, definition.types);
      const label = name + (subpath === '.' ? '' : `-${subpath.slice(2).replaceAll('/', '-')}`);
      if (!extractApiContract(project, entry, label, reports, temporary, accept)) throw new Error(`API contract changed or extraction failed: ${label}. Review npm run update:api.`);
      console.log(`API_CONTRACT_OK ${manifest.name}${subpath === '.' ? '' : subpath.slice(1)}`);
    }
  }
  const file = path.join(reports, 'package-exports.json');
  const serialized = `${JSON.stringify(canonical(exportsBaseline), null, 2)}\n`;
  if (accept) fs.writeFileSync(file, serialized);
  else if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== serialized) {
    throw new Error('Package export contracts changed. Review npm run update:api.');
  }
  console.log('API_PACKAGE_EXPORTS_OK seven packages');
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
