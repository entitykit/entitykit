const { Migration, MigrationRunner } = require('@entitykit/core/migrations');

class CrashBoundaryMigration extends Migration {
  id = '20261003000000_CrashBoundary';
  name = 'CrashBoundary';
  up(builder) {
    builder.createTable('entitykit_crash_probe', [{ name: 'id', type: 'integer', primaryKey: true }]);
    builder.sql('insert into entitykit_crash_probe (id) values (1)');
  }
  down(builder) { builder.dropTable('entitykit_crash_probe'); }
}

function crashMigrationRunner(source, connection) {
  return new MigrationRunner(connection, source.migrationDialect, source.createMigrationBuilder);
}

function crashTableExists(provider) {
  if (provider === 'sqlite') return "select count(*) as total from sqlite_master where type = 'table' and name = 'entitykit_crash_probe'";
  const schema = provider === 'mysql' ? 'table_schema = database()' : "table_schema = 'public'";
  return `select count(*) as total from information_schema.tables where ${schema} and table_name = 'entitykit_crash_probe'`;
}

module.exports = { CrashBoundaryMigration, crashMigrationRunner, crashTableExists };
