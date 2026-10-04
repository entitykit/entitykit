const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const { historicalMigrationContract, historicalProvider } = require('./historical-migration-contract');
const { installHistoricalPackages, validateHistoricalPackages } = require('./install-historical-packages');
const { preserveHistoricalMigrationSql } = require('./preserve-historical-migration-sql');

const root = path.resolve(__dirname, '..');
const fixture = require('../tests/fixtures/migration-compatibility/alpha-1.json');
const requireCandidate = createRequire(path.join(root, 'package.json'));
const core = requireCandidate('@entitykit/core');
const migrations = requireCandidate('@entitykit/core/migrations');

async function verifyMetadata() {
  for (const provider of ['sqlite', 'postgres', 'mysql']) {
    const target = provider === 'sqlite' ? ':memory:' : `${provider === 'mysql' ? 'mysql' : 'postgres'}://entitykit@127.0.0.1:1/entitykit_legacy_test`;
    const source = historicalProvider(requireCandidate, provider, target);
    const contract = historicalMigrationContract(core, migrations, source);
    const reviewed = preserveHistoricalMigrationSql(migrations, provider, contract.historical);
    const db = contract.HistoricalContext.create();
    try {
      const expected = fixture.providers[provider];
      assert.equal(migrations.migrationChecksum(reviewed, source.dialect, source.createMigrationBuilder), expected.checksum);
      const authoredChecksum = migrations.migrationChecksum(contract.historical, source.dialect, source.createMigrationBuilder);
      if (provider === 'sqlite') assert.notEqual(authoredChecksum, expected.checksum);
      else assert.equal(authoredChecksum, expected.checksum);
      const generator = new migrations.MigrationSqlGenerator(source.migrationDialect, source.createMigrationBuilder);
      const domain = statements => statements.filter(statement => !statement.text.includes('__entitykit_migrations'));
      assert.deepEqual(domain(generator.buildUpStatements(reviewed)), domain(expected.up));
      assert.deepEqual(domain(generator.buildDownStatements(reviewed)), domain(expected.down));
      const authoredUp = domain(expected.up).map(statement => provider === 'sqlite'
        ? { ...statement, text: statement.text.replace('"id" varchar(64) primary key', '"id" varchar(64) not null primary key') }
        : statement);
      assert.deepEqual(domain(generator.buildUpStatements(contract.historical)), authoredUp);
      assert.deepEqual(domain(generator.buildDownStatements(contract.historical)), domain(expected.down));
      const current = migrations.contextMigrations(db).createModelSnapshot();
      assert.deepEqual(migrations.diffModelSnapshots(expected.snapshot, current).operations, []);
      console.log(`MIGRATION_HISTORICAL_FORMAT_OK ${provider} alpha.1`);
    } finally {
      await db.dispose();
      await source.dispose();
    }
  }
}

async function verifyUpgrade(provider, target, consumer) {
  const seeded = spawnSync(process.execPath, [
    '--unhandled-rejections=strict', path.join(__dirname, 'seed-historical-database.js'), provider,
  ], { encoding: 'utf8', timeout: 30_000, env: {
    ...process.env, ENTITYKIT_LEGACY_CONSUMER: consumer, ENTITYKIT_COMPAT_DATABASE_URL: target,
  } });
  if (seeded.status !== 0) throw new Error(`Historical ${provider} application failed to seed its database.`);
  const source = historicalProvider(requireCandidate, provider, target);
  const contract = historicalMigrationContract(core, migrations, source);
  const originalHistorical = contract.historical;
  contract.historical = preserveHistoricalMigrationSql(migrations, provider, originalHistorical);
  const db = contract.HistoricalContext.create();
  try {
    const runner = new migrations.MigrationRunner(db.database.connection, source.migrationDialect, source.createMigrationBuilder);
    const historical = await runner.getAppliedMigrations({ initializeHistory: false });
    assert.equal(historical.length, 1);
    assert.equal(historical[0].checksum, fixture.providers[provider].checksum);
    assert.equal(historical[0].entityKitVersion, fixture.releasedVersion);
    if (provider === 'sqlite') {
      await assert.rejects(runner.update([originalHistorical]), migrations.MigrationChecksumError);
      assert.deepEqual(await runner.getAppliedMigrations({ initializeHistory: false }), historical);
      console.log('MIGRATION_CHANGED_SQL_REFUSED_ORIGINAL_HISTORY_OK sqlite');
    }
    assert.deepEqual((await runner.update([contract.historical])).appliedMigrations, []);
    const legacyBook = await db.books.findOrThrow('legacy-book');
    assert.equal(legacyBook.title, 'Published alpha.1 application data');
    assert.equal(legacyBook.version, 1);
    legacyBook.title = 'Read and saved after upgrading';
    await db.saveChanges();
    assert.equal(legacyBook.version, 2);
    assert.deepEqual((await runner.update([contract.historical, contract.next])).appliedMigrations, [`up:${contract.next.id}`]);
    const after = await runner.getAppliedMigrations({ initializeHistory: false });
    assert.deepEqual(after[0], historical[0]);
    assert.equal(after[1].entityKitVersion, require('../package.json').version);
    assert.deepEqual((await runner.update([contract.historical, contract.next])).appliedMigrations, []);
    assert.deepEqual((await runner.update([contract.historical, contract.next], { target: contract.historical.id, allowDataLoss: true })).appliedMigrations,
      [`down:${contract.next.id}`]);
    assert.deepEqual(await runner.getAppliedMigrations({ initializeHistory: false }), historical);
    db.clearChanges();
    assert.equal((await db.books.findOrThrow('legacy-book')).version, 2);
    class ChangedHistoricalMigration extends migrations.Migration {
      id = contract.historical.id;
      name = contract.historical.name;
      up(builder) { contract.historical.up(builder); builder.sql('select 1'); }
      down(builder) { contract.historical.down(builder); }
    }
    await assert.rejects(runner.update([new ChangedHistoricalMigration()]), migrations.MigrationChecksumError);
    assert.deepEqual(await runner.getAppliedMigrations({ initializeHistory: false }), historical);
    console.log(`MIGRATION_RELEASE_UPGRADE_ROLLBACK_OK ${provider} ${fixture.releasedVersion} -> ${require('../package.json').version}`);
  } finally {
    await db.dispose();
    await source.dispose();
  }
}

async function main() {
  const provider = process.argv[2] ?? 'sqlite';
  if (!['sqlite', 'postgres', 'mysql'].includes(provider)) throw new Error('Choose sqlite, postgres, or mysql.');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'entitykit-migration-compat-'));
  try {
    const target = provider === 'sqlite' ? path.join(temporary, 'legacy.db') : process.env.ENTITYKIT_COMPAT_DATABASE_URL;
    if (!target || provider !== 'sqlite' && !/test|qualification|hardening/u.test(new URL(target).pathname)) {
      throw new Error('Compatibility qualification requires an isolated test, qualification, or hardening database.');
    }
    await verifyMetadata();
    const consumer = process.env.ENTITYKIT_LEGACY_CONSUMER ?? path.join(temporary, 'historical-consumer');
    if (process.env.ENTITYKIT_LEGACY_CONSUMER) validateHistoricalPackages(consumer, fixture);
    else installHistoricalPackages(consumer, fixture, root, process.env.npm_execpath);
    await verifyUpgrade(provider, target, consumer);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
