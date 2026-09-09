// ESM acceptance: `import` the published CommonJS tarballs and drive the same
// real SQLite database end to end. The provider arrives through the explicit
// `useProvider` seam here, so the ESM lane covers the path a user wires by
// hand rather than core's lazy built-in loader.
import { DbContext, EntityState } from '@entitykit/core';
import {
  EntityKitModule,
  getEntityKitContextRunnerToken,
} from '@entitykit/nestjs';
import { createSqliteDataSource, sqliteProviderServices } from '@entitykit/sqlite';
import { createPostgresDataSource } from '@entitykit/postgres';
import { Test } from '@nestjs/testing';

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
    options.useProvider(sqliteProviderServices, ':memory:');
  }

  model(model) {
    model.entity(Widget, entity => {
      entity.toTable('widgets');
      entity.hasKey(widget => widget.id);
      entity.property(widget => widget.id).hasColumnType('text').isRequired();
      entity.property(widget => widget.label).hasColumnType('text').isRequired();
      entity.materializeChecked(row => new Widget({
        id: row.required(widget => widget.id),
        label: row.required(widget => widget.label),
      }));
    });
  }
}

class LifecycleContext extends DbContext {
  constructor(source, requestId) {
    super(source);
    this.requestId = requestId;
  }
}

if (
  DbContext.name !== 'DbContext'
  || EntityKitModule.name !== 'EntityKitModule'
  || sqliteProviderServices.name !== 'sqlite'
) {
  throw new Error('Packaged ESM imports did not resolve CommonJS exports.');
}

const sharedSource = createSqliteDataSource(':memory:');
const nestModule = await Test.createTestingModule({
  imports: [
    EntityKitModule.forRoot({ dataSource: sharedSource }),
    EntityKitModule.forFeature([LifecycleContext]),
  ],
}).compile();
await nestModule.init();
const runner = nestModule.get(getEntityKitContextRunnerToken(LifecycleContext));
await runner.run(async context => {
  if (context.requestId !== 'packed-consumer') {
    throw new Error('The packaged Nest runner did not forward context arguments.');
  }
  return context.database.connection.query({
    text: 'select 1 as value',
    values: [],
  });
}, 'packed-consumer');
await nestModule.close();
let sourceClosed = false;
try {
  sharedSource.createContext(LifecycleContext);
} catch (error) {
  sourceClosed = error instanceof Error && error.message.includes('disposed');
}
if (!sourceClosed) {
  throw new Error('The packaged Nest module did not close its owned data source.');
}

const externalSource = createSqliteDataSource(':memory:');
const asyncNestModule = await Test.createTestingModule({
  imports: [
    EntityKitModule.forRootAsync({
      useFactory: async () => ({
        dataSource: externalSource,
        ownership: 'external',
      }),
    }),
    EntityKitModule.forFeature([LifecycleContext]),
  ],
}).compile();
await asyncNestModule.init();
await asyncNestModule.close();
const externalContext = externalSource.createContext(LifecycleContext, 'external-owner');
await externalContext.dispose();
await externalSource.dispose();

const postgresSource = createPostgresDataSource(
  'postgres://entitykit:entitykit@127.0.0.1:1/entitykit_package_check',
);
await postgresSource.dispose();

const db = ConsumerContext.create();
await db.database.connection.query({
  text: 'create table widgets (id text primary key, label text not null)',
  values: [],
});
db.widgets.create({ id: 'two', label: 'Second' });
if (await db.saveChanges() !== 1) {
  throw new Error('Packaged SQLite save failed under ESM.');
}
db.clearTracking();
const rows = await db.widgets.toArray();
if (rows.length !== 1 || rows[0].label !== 'Second') {
  throw new Error('Packaged SQLite query failed under ESM.');
}
if (db.entryOrThrow(rows[0]).state !== EntityState.Unchanged) {
  throw new Error('Packaged materialization did not track the loaded entity.');
}
await db.dispose();

process.stdout.write('PACKAGE_ESM_IMPORT_OK\n');
