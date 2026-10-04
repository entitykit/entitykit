const assert = require('node:assert/strict');
const path = require('node:path');
const { fork } = require('node:child_process');
const { qualificationSource, within, withConnection, statement } = require('./provider-qualification');
const { CrashBoundaryMigration, crashMigrationRunner, crashTableExists } = require('./migration-crash-contract');

async function killMigratingChild(provider, target) {
  await new Promise((resolve, reject) => {
    const child = fork(path.join(__dirname, 'migration-crash-child.js'), [provider], {
      execArgv: ['--unhandled-rejections=strict'], env: { ...process.env, ENTITYKIT_OPERATION_DATABASE_URL: target },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    let reached = false;
    const timeout = setTimeout(() => { child.kill('SIGKILL'); }, 5_000);
    child.on('message', message => {
      if (message?.checkpoint === 'ddl-completed-before-history') {
        reached = true;
        child.kill('SIGKILL');
      }
    });
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('exit', (code, signal) => {
      clearTimeout(timeout);
      if (reached && signal === 'SIGKILL') resolve();
      else reject(new Error('Migration child did not reach its real DDL crash boundary.'));
    });
  });
}

async function qualifyMigrationCrash(provider, target) {
  let source = qualificationSource(provider, target);
  try {
    await withConnection(source, async connection => {
      await connection.query(statement('drop table if exists entitykit_crash_probe'));
      await connection.query(statement('drop table if exists __entitykit_migrations'));
    });
    await source.dispose();
    await killMigratingChild(provider, target);
    source = qualificationSource(provider, target);
    await withConnection(source, async connection => {
      const runner = crashMigrationRunner(source, connection);
      assert.deepEqual(await runner.getAppliedMigrations({ initializeHistory: false }), []);
      const exists = await within(connection.query(statement(crashTableExists(provider))));
      assert.equal(Number(exists.rows[0].total), provider === 'mysql' ? 1 : 0);
      if (provider === 'mysql') {
        // Inspect the isolated, empty partial object before deliberately repairing it.
        assert.deepEqual((await connection.query(statement('select * from entitykit_crash_probe'))).rows, []);
        const columns = await connection.query(statement("select column_name from information_schema.columns where table_schema = database() and table_name = 'entitykit_crash_probe' order by ordinal_position"));
        assert.deepEqual(columns.rows.map(row => row.COLUMN_NAME ?? row.column_name), ['id']);
        await connection.query(statement('drop table entitykit_crash_probe'));
      }
      const migration = new CrashBoundaryMigration();
      assert.deepEqual((await within(runner.update([migration]), 5_000, 'migration lock recovery')).appliedMigrations, [`up:${migration.id}`]);
      assert.deepEqual((await runner.update([migration])).appliedMigrations, []);
      assert.equal((await runner.getAppliedMigrations({ initializeHistory: false })).length, 1);
      assert.deepEqual((await connection.query(statement('select id from entitykit_crash_probe'))).rows.map(row => row.id), [1]);
      await runner.update([migration], { target: '0', allowDataLoss: true });
      assert.deepEqual(await runner.getAppliedMigrations({ initializeHistory: false }), []);
      assert.equal(Number((await connection.query(statement(crashTableExists(provider)))).rows[0].total), 0);
      await connection.query(statement('drop table __entitykit_migrations'));
    });
    console.log(`PROVIDER_MIGRATION_PROCESS_CRASH_REPAIR_OK ${provider} transactionalDDL=${provider !== 'mysql'}`);
  } finally { await source.dispose(); }
}

module.exports = { qualifyMigrationCrash };
