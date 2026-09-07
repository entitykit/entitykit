// CommonJS acceptance: `require` the published tarballs and drive a real
// SQLite database end to end. `useSqlite` deliberately takes core's lazy
// `createRequire` path into `@entitykit/sqlite`, so this also proves core can
// find its sibling provider from an installed tree.
const { DbContext, EntityState } = require('@entitykit/core');
const {
  createMySqlDataSource,
  mySqlProviderServices,
} = require('@entitykit/mysql');
const {
  createPostgresDataSource,
  postgresProviderServices,
} = require('@entitykit/postgres');
const { sqliteProviderServices } = require('@entitykit/sqlite');
const { RecordingDatabaseConnection } = require('@entitykit/testing');
const { getEntityKitCliMetadata } = require('@entitykit/cli');

class Widget {
  constructor(input) {
    this.id = input.id;
    this.label = input.label;
  }
}

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
      entity.materialize(values => new Widget(values));
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
  if (!(new RecordingDatabaseConnection())) {
    throw new Error('Packaged testing doubles did not load.');
  }
  if (getEntityKitCliMetadata().schemaVersion !== 1) {
    throw new Error('Packaged CLI library entry point did not load.');
  }

  // Pool construction is lazy with respect to the network, so this proves the
  // packed providers resolve their runtime peers without needing live servers.
  const postgresSource = createPostgresDataSource(
    'postgres://entitykit:entitykit@127.0.0.1:1/entitykit_package_check',
  );
  await postgresSource.dispose();
  const mysqlSource = createMySqlDataSource(
    'mysql://entitykit:entitykit@127.0.0.1:1/entitykit_package_check',
  );
  await mysqlSource.dispose();

  const db = ConsumerContext.create();
  await db.database.connection.query({
    text: 'create table widgets (id text primary key, label text not null)',
    values: [],
  });
  const widget = db.widgets.create({ id: 'one', label: 'First' });
  if (db.changeTracker.entry(widget).state !== EntityState.Added) {
    throw new Error('Packaged change tracking did not report the added entity.');
  }
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
