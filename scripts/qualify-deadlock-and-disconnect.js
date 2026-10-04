const assert = require('node:assert/strict');
const { isTransactionOutcomeUnknown } = require('@entitykit/core/adapter');
const { qualificationSource, within, withConnection, statement } = require('./provider-qualification');
const { commitAcknowledgmentProxy } = require('./commit-acknowledgment-proxy');

async function qualifyDeadlockAndDisconnect(provider, target) {
  const source = qualificationSource(provider, target, 2, { retry: { maxAttempts: 3, initialDelayMs: 0, jitter: false } });
  let attempts = 0;
  let arrivals = 0;
  let rendezvous;
  const bothLocked = new Promise(resolve => { rendezvous = resolve; });
  const failures = [];
  try {
    await withConnection(source, async connection => {
      await connection.query(statement('drop table if exists entitykit_deadlock_probe'));
      await connection.query(statement('create table entitykit_deadlock_probe (id integer primary key, value integer not null)'));
      await connection.query(statement('insert into entitykit_deadlock_probe (id, value) values (1, 0), (2, 0)'));
    });
    await within(Promise.all([1, 2].map(id => source.executeWithRetry(async attempt => {
      attempts += 1;
      return withConnection(source, async connection => {
        try {
          return await connection.transaction(async () => {
            await connection.query(statement(`update entitykit_deadlock_probe set value = value + 1 where id = ${id}`));
            if (attempt.attempt === 1) {
              arrivals += 1;
              if (arrivals === 2) rendezvous();
              await within(bothLocked);
            }
            await connection.query(statement(`update entitykit_deadlock_probe set value = value + 1 where id = ${3 - id}`));
          });
        } catch (error) { failures.push(error); throw error; }
      });
    }))), 5_000, 'deadlock retry recovery');
    assert.equal(attempts, 3);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].code, provider === 'postgres' ? '40P01' : 'ER_LOCK_DEADLOCK');
    assert.equal(isTransactionOutcomeUnknown(failures[0]), false);
    await withConnection(source, async connection => {
      assert.deepEqual((await connection.query(statement('select id, value from entitykit_deadlock_probe order by id'))).rows,
        [{ id: 1, value: 2 }, { id: 2, value: 2 }]);
    });
    console.log(`PROVIDER_DEADLOCK_ATOMIC_RETRY_OK ${provider} attempts=3 committed=2`);
    await qualifyDisconnect(provider, target);
  } finally {
    await withConnection(source, connection => connection.query(statement('drop table if exists entitykit_deadlock_probe')));
    await source.dispose();
  }
}

async function qualifyDisconnect(provider, target) {
  const proxy = await commitAcknowledgmentProxy(provider, target);
  const source = qualificationSource(provider, proxy.target);
  const failed = source.createConnection();
  try {
    await within(assert.rejects(failed.transaction(async () => {
      await failed.query(statement('insert into entitykit_deadlock_probe (id, value) values (3, 99)'));
      proxy.disconnect();
      await new Promise(resolve => setTimeout(resolve, 25));
      await failed.query(statement('select 42 as answer'));
    }), error => {
      assert.equal(isTransactionOutcomeUnknown(error), false);
      return true;
    }), 2_000, 'checked-out client disconnect');
    assert.equal(failed.isInTransaction, false);
    // A known pre-commit failure discards the physical client and permits
    // the logical lease to acquire a healthy replacement for a new operation.
    assert.equal((await within(failed.query(statement('select 42 as answer')))).rows[0].answer, 42);
    await failed.dispose();
    await withConnection(source, async connection => {
      const count = await within(connection.query(statement('select count(*) as total from entitykit_deadlock_probe where id = 3')));
      assert.equal(Number(count.rows[0].total), 0);
      await connection.transaction(async () => connection.query(statement('insert into entitykit_deadlock_probe (id, value) values (3, 1)')));
      assert.equal((await connection.query(statement('select value from entitykit_deadlock_probe where id = 3'))).rows[0].value, 1);
    });
    console.log(`PROVIDER_CHECKED_OUT_DISCONNECT_ROLLBACK_RECOVERY_OK ${provider}`);
  } finally {
    await failed.dispose();
    await source.dispose();
    await proxy.close();
  }
}

module.exports = { qualifyDeadlockAndDisconnect };
