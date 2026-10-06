const path = require('node:path');
const { createRequire } = require('node:module');
const { historicalMigrationContract, historicalProvider } = require('./historical-migration-contract');

async function seed() {
  const requireOld = createRequire(path.join(process.env.ENTITYKIT_LEGACY_CONSUMER, 'package.json'));
  const core = requireOld('@entitykit/core');
  const migrations = requireOld('@entitykit/core/migrations');
  const releasedVersion = requireOld('@entitykit/core/package.json').version;
  if (releasedVersion !== process.env.ENTITYKIT_LEGACY_VERSION) throw new Error('Historical release identity differs.');
  const provider = process.argv[2];
  const source = historicalProvider(requireOld, provider, process.env.ENTITYKIT_COMPAT_DATABASE_URL);
  const contract = historicalMigrationContract(core, migrations, source);
  const db = contract.HistoricalContext.create();
  try {
    for (const table of ['entitykit_historical_books', '__entitykit_migrations']) {
      await db.database.connection.query({ text: `drop table if exists ${source.dialect.quoteIdentifier(table)}`, values: [] });
    }
    const runner = new migrations.MigrationRunner(db.database.connection, source.migrationDialect, source.createMigrationBuilder);
    await runner.update([contract.historical]);
    db.books.add(Object.assign(new contract.HistoricalBook(), {
      id: 'legacy-book', title: `Published ${releasedVersion} application data`,
    }));
    await db.saveChanges();
    console.log(`HISTORICAL_DATABASE_SEEDED ${releasedVersion}`);
  } finally {
    await db.dispose();
    await source.dispose();
  }
}

seed().catch(() => { console.error('Historical database seeding failed.'); process.exitCode = 1; });
