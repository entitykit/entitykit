const assert = require('node:assert/strict');
const { OperationCanceledError } = require('@entitykit/core');
const { qualificationTarget, qualificationSource, within, withConnection, statement } = require('./provider-qualification');
const { qualifyPreaborted, qualifyQueued, qualifyActiveQuery } = require('./qualify-pool-cancellation');

async function qualifyStreams(source) {
  await withConnection(source, async connection => {
    const values = Array.from({ length: 128 }, (_, index) => `(${index})`).join(', ');
    await connection.query(statement(`insert into entitykit_operation_probe (id) values ${values}`));
  });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await withConnection(source, async connection => {
      const controller = new AbortController();
      const iterator = connection.stream(statement('select id from entitykit_operation_probe order by id'),
        { batchSize: 7, signal: controller.signal })[Symbol.asyncIterator]();
      try {
        for (let index = 0; index < 5; index += 1) assert.equal((await within(iterator.next())).value.id, index);
        if (attempt % 2 === 0) {
          controller.abort('consumer stopped');
          await within(assert.rejects(iterator.next(), OperationCanceledError));
        }
      } finally {
        await within(iterator.return());
      }
      assert.equal((await within(connection.query(statement('select 42 as answer')))).rows[0].answer, 42);
    });
  }
}

async function main() {
  const provider = process.argv[2];
  const { target, cleanup } = qualificationTarget(provider);
  const source = qualificationSource(provider, target);
  const warnings = [];
  const observeWarning = warning => { if (warning.code === 'ENTITYKIT_CANCELED_RESOURCE_CLEANUP') warnings.push(warning.code); };
  process.on('warning', observeWarning);
  try {
    await withConnection(source, async connection => {
      await connection.query(statement('drop table if exists entitykit_operation_probe'));
      await connection.query(statement('create table entitykit_operation_probe (id integer primary key)'));
    });
    await qualifyPreaborted(source);
    console.log(`PROVIDER_PREABORTED_OPERATIONS_OK ${provider}`);
    if (provider !== 'sqlite') {
      await qualifyQueued(source);
      console.log(`PROVIDER_QUEUED_CANCELLATION_RECOVERY_OK ${provider} rounds=3 queued=96 pool=1`);
      await qualifyActiveQuery(source, provider);
      console.log(`PROVIDER_ACTIVE_QUERY_CANCELLATION_RECOVERY_OK ${provider}`);
    }
    await qualifyStreams(source);
    console.log(`PROVIDER_STREAM_EARLY_EXIT_RECOVERY_OK ${provider} rounds=20 batch=7`);
    await withConnection(source, connection => connection.query(statement('drop table entitykit_operation_probe')));
    await within(source.dispose(), 2_000, 'data source shutdown');
    if (provider !== 'sqlite') {
      await require('./qualify-lost-commit-acknowledgment').qualifyLostCommitAcknowledgment(provider, target);
    }
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(warnings, []);
    console.log(`PROVIDER_RESOURCE_SHUTDOWN_OK ${provider}`);
  } finally {
    await source.dispose();
    process.removeListener('warning', observeWarning);
    cleanup();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
