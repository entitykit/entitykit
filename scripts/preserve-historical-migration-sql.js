// Pin the reviewed, published SQL rather than re-rendering an applied callback
// with a newer DDL policy. The original authored source and receipt stay fixed.
function preserveHistoricalMigrationSql(migrations, provider, historical, fixture) {
  const recorded = fixture.providers[provider];
  const domain = direction => recorded[direction].filter(statement =>
    !statement.text.includes('__entitykit_migrations'));
  class ReviewedHistoricalMigration extends migrations.Migration {
    id = historical.id;
    name = historical.name;
    up(builder) {
      for (const statement of domain('up')) builder.sql(statement.text, statement.values,
        { suppressTransaction: statement.suppressTransaction });
    }
    down(builder) {
      for (const statement of domain('down')) builder.sql(statement.text, statement.values,
        { suppressTransaction: statement.suppressTransaction });
    }
  }
  return new ReviewedHistoricalMigration();
}

module.exports = { preserveHistoricalMigrationSql };
