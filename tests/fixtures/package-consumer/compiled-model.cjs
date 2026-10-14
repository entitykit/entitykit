const assert = require('node:assert/strict');

module.exports = async function checkCompiledModel({ compileModel, DbContext }) {
  class Row { id = 0; label = ''; }
  let retained;
  let builds = 0;
  const compiled = compileModel(model => {
    builds++;
    model.entity(Row, entity => {
      retained = entity;
      entity.toTable('compiled_rows').hasKey(row => row.id);
      entity.property(row => row.id).hasColumnType('integer').isRequired();
      entity.property(row => row.label).hasColumnType('text').isRequired();
    });
  }, { provider: 'sqlite' });
  retained.toTable('changed_after_compilation');
  let configurations = 0;
  class CompiledContext extends DbContext {
    rows = this.set(Row);
    configure(options) {
      configurations++;
      options.useCompiledModel(compiled).useSqlite(':memory:');
    }
    model() { throw new Error('Explicit compiled model must bypass model().'); }
  }
  const first = CompiledContext.create();
  const second = CompiledContext.create();
  try {
    for (const db of [first, second]) {
      await db.database.connection.query({
        text: 'create table compiled_rows (id integer primary key, label text not null)', values: [],
      });
      db.rows.add(Object.assign(new Row(), { id: 1, label: db === first ? 'first' : 'second' }));
      assert.equal(await db.saveChanges(), 1);
      db.clearTracking();
    }
    const a = await first.rows.asNoTracking().single();
    const b = await second.rows.asNoTracking().single();
    assert.deepEqual([a.label, b.label], ['first', 'second']);
    assert.notEqual(a, b);
    first.rows.attach(a);
    a.label = 'updated';
    assert.equal(await first.saveChanges(), 1);
    assert.equal((await second.rows.asNoTracking().single()).label, 'second');
    assert.equal(builds, 1);
    assert.equal(configurations, 2);
    assert.equal(Object.isFrozen(compiled), true);
  } finally {
    await first.dispose();
    await second.dispose();
  }
};
