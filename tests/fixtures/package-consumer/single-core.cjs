// The crown invariant of the multi-package release: ONE @entitykit/core.
//
// Core keys tracking state in module-level WeakMaps (entry snapshots,
// navigation journals, public tracker identity) and reaches across the
// provider seam with `instanceof` brand checks. Two physical copies of core in
// one install would split-brain silently: entities tracked through a
// provider-built context would miss the WeakMaps the directly-imported core
// reads, and provider errors raised by copy B would fail copy A's instanceof.
// Nothing throws at install time, so only an explicit check catches it.
//
// Two independent mechanisms are asserted, both from the installed tarballs:
//
//  1. Resolution identity. Every sibling package resolves '@entitykit/core'
//     from ITS OWN installed entry file (createRequire pinned to that file),
//     and each result must equal the consumer root's require.resolve AND
//     return the very same module object — the same Node module-cache entry,
//     therefore the same module-level WeakMaps.
//  2. Cross-seam brand identity. A DbContext built through
//     @entitykit/sqlite's provider services raises a failure that the sqlite
//     package constructs from ITS core; the consumer asserts it is
//     `instanceof DatabaseProviderError` imported from ITS core. A duplicated
//     core makes that check false while every structural test still passes.
const path = require('node:path');
const { createRequire } = require('node:module');
const { DatabaseProviderError, DbContext, EntityState } = require('@entitykit/core');
const { sqliteProviderServices } = require('@entitykit/sqlite');

const siblings = [
  '@entitykit/sqlite',
  '@entitykit/postgres',
  '@entitykit/mysql',
  '@entitykit/nestjs',
  '@entitykit/cli',
  '@entitykit/testing',
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function resolutionIdentity() {
  const expectedPath = require.resolve('@entitykit/core');
  const expectedModule = require('@entitykit/core');

  for (const sibling of siblings) {
    const entry = require.resolve(sibling);
    const requireFromSibling = createRequire(entry);
    const resolved = requireFromSibling.resolve('@entitykit/core');
    assert(
      resolved === expectedPath,
      `${sibling} resolves @entitykit/core to ${resolved}, not ${expectedPath}.`,
    );
    assert(
      requireFromSibling('@entitykit/core') === expectedModule,
      `${sibling} loaded a second @entitykit/core module object.`,
    );
    assert(
      requireFromSibling('@entitykit/core/adapter')
        === require('@entitykit/core/adapter'),
      `${sibling} loaded a second @entitykit/core/adapter module object.`,
    );
  }
  return expectedPath;
}

class Widget {}

class ConsumerContext extends DbContext {
  constructor() {
    super();
    this.widgets = this.set(Widget);
  }

  configure(options) {
    // Deliberately the provider seam, not core's built-in loader: the services
    // object is built inside @entitykit/sqlite against ITS resolution of core.
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

async function brandIdentity() {
  const db = ConsumerContext.create();
  try {
    await db.database.connection.query({
      text: 'create table widgets (id text primary key, label text not null)',
      values: [],
    });
    const widget = Object.assign(new Widget(), { id: 'one', label: 'First' });
    db.widgets.add(widget);
    await db.saveChanges();

    // Tracking state written through the provider-built context must be
    // visible to the directly-imported core's WeakMap-backed entry lookup.
    const entry = db.changeTracker.entry(widget);
    assert(entry !== undefined, 'The directly-imported core lost the tracked entity.');
    assert(
      entry.state === EntityState.Unchanged,
      'The directly-imported core disagreed about the tracked entity state.',
    );
    assert(
      db.changeTracker.entry(widget) === entry,
      'Core handed out two entries for one entity: its WeakMaps are split.',
    );

    let raised;
    try {
      await db.database.connection.query({
        text: 'insert into widgets (id, label) values (?, ?)',
        values: ['one', 'Duplicate'],
      });
    } catch (error) {
      raised = error;
    }
    assert(raised !== undefined, 'The duplicate insert did not fail.');
    assert(
      raised instanceof DatabaseProviderError,
      'A @entitykit/sqlite failure is not instanceof the consumer\'s '
      + 'DatabaseProviderError: two cores are installed.',
    );
  } finally {
    await db.dispose();
  }
}

async function main() {
  const resolved = resolutionIdentity();
  await brandIdentity();
  process.stdout.write(
    `PACKAGE_SINGLE_CORE_OK ${String(siblings.length + 1)} packages share `
    + `${path.relative(process.cwd(), resolved)}\n`,
  );
}

main().catch(error => {
  process.stderr.write(`${error.stack ?? String(error)}\n`);
  process.exitCode = 1;
});
