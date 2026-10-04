const { qualificationSource } = require('./provider-qualification');
const { CrashBoundaryMigration, crashMigrationRunner } = require('./migration-crash-contract');

async function main() {
  const provider = process.argv[2];
  const source = qualificationSource(provider, process.env.ENTITYKIT_OPERATION_DATABASE_URL);
  const connection = source.createConnection();
  const intercepted = {
    get isInTransaction() { return connection.isInTransaction; },
    transaction: (work, options) => connection.transaction(work, options),
    session: (work, options) => connection.session(work, options),
    async query(statement, options) {
      const result = await connection.query(statement, options);
      if (/^create table/iu.test(statement.text) && statement.text.includes('entitykit_crash_probe')) {
        setInterval(() => {}, 1_000); // Keep SQLite's paused process alive for an actual SIGKILL.
        process.send({ checkpoint: 'ddl-completed-before-history' });
        await new Promise(() => {});
      }
      return result;
    },
  };
  try { await crashMigrationRunner(source, intercepted).update([new CrashBoundaryMigration()]); }
  finally { await connection.dispose(); await source.dispose(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
