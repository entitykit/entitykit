// ESM acceptance: `import` the published CommonJS tarballs and drive the same
// real SQLite database end to end. The provider arrives through the explicit
// `useProvider` seam here, so the ESM lane covers the path a user wires by
// hand rather than core's lazy built-in loader.
import { DbContext, EntityState } from '@entitykit/core';
import { sqliteProviderServices } from '@entitykit/sqlite';

class Widget {}

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
    });
  }
}

if (DbContext.name !== 'DbContext' || sqliteProviderServices.name !== 'sqlite') {
  throw new Error('Packaged ESM imports did not resolve CommonJS exports.');
}

const db = ConsumerContext.create();
await db.database.connection.query({
  text: 'create table widgets (id text primary key, label text not null)',
  values: [],
});
db.widgets.add(Object.assign(new Widget(), { id: 'two', label: 'Second' }));
if (await db.saveChanges() !== 1) {
  throw new Error('Packaged SQLite save failed under ESM.');
}
db.changeTracker.clear();
const rows = await db.widgets.toArray();
if (rows.length !== 1 || rows[0].label !== 'Second') {
  throw new Error('Packaged SQLite query failed under ESM.');
}
if (db.changeTracker.entry(rows[0]).state !== EntityState.Unchanged) {
  throw new Error('Packaged materialization did not track the loaded entity.');
}
await db.dispose();

process.stdout.write('PACKAGE_ESM_IMPORT_OK\n');
