const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { historicalMigrationContract, historicalProvider } = require('./historical-migration-contract');

async function record() {
  const consumer = path.resolve(process.argv[2]);
  const requireOld = createRequire(path.join(consumer, 'package.json'));
  const core = requireOld('@entitykit/core');
  const migrations = requireOld('@entitykit/core/migrations');
  const lock = JSON.parse(fs.readFileSync(path.join(consumer, 'package-lock.json'), 'utf8'));
  const fixture = { formatVersion: 1, releasedVersion: '0.1.0-alpha.1', packages: {}, providers: {} };
  for (const name of ['core', 'sqlite', 'postgres', 'mysql']) {
    const installed = lock.packages[`node_modules/@entitykit/${name}`];
    if (installed.version !== fixture.releasedVersion || !installed.integrity) {
      throw new Error('Historical generation requires the exact published alpha.1 package family.');
    }
    fixture.packages[`@entitykit/${name}`] = { version: installed.version, integrity: installed.integrity };
  }
  for (const provider of ['sqlite', 'postgres', 'mysql']) {
    const target = provider === 'sqlite' ? ':memory:' : `${provider === 'mysql' ? 'mysql' : 'postgres'}://entitykit@127.0.0.1:1/entitykit_legacy_test`;
    const source = historicalProvider(requireOld, provider, target);
    const contract = historicalMigrationContract(core, migrations, source);
    const db = contract.HistoricalContext.create();
    try {
      const generator = new migrations.MigrationSqlGenerator(source.migrationDialect, source.createMigrationBuilder);
      fixture.providers[provider] = {
        id: contract.historical.id, name: contract.historical.name,
        checksum: migrations.migrationChecksum(contract.historical, source.dialect, source.createMigrationBuilder),
        up: generator.buildUpStatements(contract.historical),
        down: generator.buildDownStatements(contract.historical),
        snapshot: migrations.contextMigrations(db).createModelSnapshot(),
      };
    } finally {
      await db.dispose();
      await source.dispose();
    }
  }
  const destination = path.join(__dirname, '..', 'tests', 'fixtures', 'migration-compatibility', 'alpha-1.json');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log('HISTORICAL_MIGRATION_FIXTURE_RECORDED alpha.1 SQLite Postgres MySQL');
}

record().catch(error => { console.error(error.message); process.exitCode = 1; });
