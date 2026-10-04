const assert = require('node:assert/strict');
const { OperationCanceledError } = require('@entitykit/core');
const { within, withConnection, statement } = require('./provider-qualification');

function execute(connection, operation, signal, work) {
  switch (operation) {
    case 'query': return connection.query(statement('insert into entitykit_operation_probe (id) values (999)'), { signal });
    case 'stream': return connection.stream(statement('select id from entitykit_operation_probe'), { signal })[Symbol.asyncIterator]().next();
    case 'transaction': return connection.transaction(work, { signal });
    case 'session': return connection.session(work, { signal });
    default: throw new Error('Unknown operation.');
  }
}

async function qualifyPreaborted(source) {
  let callbacks = 0;
  for (const operation of ['query', 'stream', 'transaction', 'session']) {
    await withConnection(source, async connection => {
      const signal = AbortSignal.abort('preaborted admission');
      await assert.rejects(Promise.resolve().then(() => execute(connection, operation, signal, () => { callbacks += 1; })), OperationCanceledError);
    });
  }
  assert.equal(callbacks, 0);
}

async function qualifyQueued(source) {
  for (let round = 0; round < 3; round += 1) {
    const holder = source.createConnection();
    let release;
    let ready;
    const acquired = new Promise(resolve => { ready = resolve; });
    const held = holder.session(async () => {
      ready();
      await new Promise(resolve => { release = resolve; });
    });
    let callbacks = 0;
    try {
      await within(acquired);
      const canceled = Array.from({ length: 32 }, (_, index) => withConnection(source, async connection => {
        const operation = ['query', 'stream', 'transaction', 'session'][index % 4];
        const signal = AbortSignal.timeout(25);
        await within(assert.rejects(execute(connection, operation, signal, () => { callbacks += 1; }), OperationCanceledError),
          1_000, `queued ${operation} cancellation`);
      }));
      await within(Promise.all(canceled));
      assert.equal(callbacks, 0);
    } finally {
      release?.();
      await within(held);
      await holder.dispose();
    }
    // This query joins the same driver queue behind all late acquisitions.
    // It can complete only if every canceled waiter returns its connection.
    await withConnection(source, async connection => {
      const result = await within(connection.query(statement('select count(*) as total from entitykit_operation_probe')));
      assert.equal(Number(result.rows[0].total), 0);
    });
  }
}

async function qualifyActiveQuery(source, provider) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await withConnection(source, async connection => {
      const sql = provider === 'postgres' ? 'select pg_sleep(5)' : 'select sleep(5)';
      await within(assert.rejects(connection.query(statement(sql), { signal: AbortSignal.timeout(40) }), OperationCanceledError),
        1_000, 'active query cancellation');
      assert.equal((await within(connection.query(statement('select 42 as answer')))).rows[0].answer, 42);
    });
  }
}

module.exports = { qualifyPreaborted, qualifyQueued, qualifyActiveQuery };
