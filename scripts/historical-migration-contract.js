// The same authored migration and context execute with the historical packages
// and the candidate packages. Keep this source when adding upgrade fixtures.
function historicalMigrationContract(core, migrations, source) {
  class HistoricalBook {
    id = '';
    title = '';
    version = 1;
  }
  class HistoricalContext extends core.DbContext {
    books = this.set(HistoricalBook);
    configure(options) { options.useDataSource(source); }
    model(model) {
      model.entity(HistoricalBook, entity => {
        entity.toTable('entitykit_historical_books').hasKey(book => book.id);
        entity.property(book => book.id).hasColumnType('varchar(64)').isRequired();
        entity.property(book => book.title).hasColumnType('varchar(120)').isRequired();
        entity.property(book => book.version).hasColumnType('integer').isRequired()
          .hasDefaultValue(1).isVersion();
      });
    }
  }
  class HistoricalBooks extends migrations.Migration {
    id = '20260801000000_HistoricalBooks';
    name = 'HistoricalBooks';
    up(builder) {
      builder.createTable('entitykit_historical_books', [
        { name: 'id', type: 'varchar(64)', nullable: false, primaryKey: true },
        { name: 'title', type: 'varchar(120)', nullable: false },
        { name: 'version', type: 'integer', nullable: false, defaultSql: '1' },
      ]);
    }
    down(builder) { builder.dropTable('entitykit_historical_books'); }
  }
  class AddEdition extends migrations.Migration {
    id = '20260801000001_AddEdition';
    name = 'AddEdition';
    up(builder) {
      builder.addColumn('entitykit_historical_books', {
        name: 'edition', type: 'integer', nullable: false, defaultSql: '1',
      });
    }
    down(builder) { builder.dropColumn('entitykit_historical_books', 'edition'); }
  }
  return { HistoricalBook, HistoricalContext, historical: new HistoricalBooks(), next: new AddEdition() };
}

function historicalProvider(requirePackage, provider, target) {
  const adapter = requirePackage(`@entitykit/${provider}`);
  const factories = { sqlite: 'createSqliteDataSource', postgres: 'createPostgresDataSource', mysql: 'createMySqlDataSource' };
  return adapter[factories[provider]](target);
}

module.exports = { historicalMigrationContract, historicalProvider };
