const { DbContext } = require('entitykit');
const { mySqlProviderServices } = require('entitykit/mysql');
const { postgresProviderServices } = require('entitykit/postgres');
const { sqliteProviderServices } = require('entitykit/sqlite');

class Widget {}

class ConsumerContext extends DbContext {
  constructor() {
    super();
    this.widgets = this.set(Widget);
  }

  configure(options) {
    options.useSqlite(':memory:');
  }

  model(model) {
    model.entity(Widget, entity => {
      entity.toTable('widgets');
      entity.hasKey(widget => widget.id);
      entity.property(widget => widget.id).hasColumnType('text').isRequired();
      entity.property(widget => widget.label).hasColumnType('text').isRequired();
    });
  }
}

async function main() {
  if (
    mySqlProviderServices.name !== 'mysql'
    || postgresProviderServices.name !== 'postgres'
    || sqliteProviderServices.name !== 'sqlite'
  ) {
    throw new Error('Packaged provider subpaths did not load.');
  }

  const db = ConsumerContext.create();
  await db.database.connection.query({
    text: 'create table widgets (id text primary key, label text not null)',
    values: [],
  });
  db.widgets.add(Object.assign(new Widget(), { id: 'one', label: 'First' }));
  if (await db.saveChanges() !== 1) {
    throw new Error('Packaged SQLite save failed.');
  }
  db.changeTracker.clear();
  const rows = await db.widgets.toArray();
  if (rows.length !== 1 || rows[0].label !== 'First') {
    throw new Error('Packaged SQLite query failed.');
  }
  await db.dispose();
  process.stdout.write('PACKAGE_RUNTIME_OK\n');
}

main().catch(error => {
  process.stderr.write(`${error.stack ?? String(error)}\n`);
  process.exitCode = 1;
});
