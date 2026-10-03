/** Count public application statements, excluding driver transaction/cursor control. */
function countedDataSource(source, counters) {
  return {
    providerName: source.providerName, dialect: source.dialect,
    migrationDialect: source.migrationDialect, createMigrationBuilder: source.createMigrationBuilder,
    valueReader: source.valueReader,
    createConnection() {
      const connection = source.createConnection();
      return {
        get isInTransaction() { return connection.isInTransaction; },
        query(statement, options) {
          counters.queries += 1;
          counters.maxParameters = Math.max(counters.maxParameters, statement.values.length);
          return connection.query(statement, options);
        },
        stream: (statement, options) => connection.stream(statement, options),
        transaction: (work, options) => connection.transaction(work, options),
        session: (work, options) => connection.session(work, options),
        dispose: () => connection.dispose(),
      };
    },
    createContext(context, ...arguments_) { return context.create(this, ...arguments_); },
    executeWithRetry: (operation, options) => source.executeWithRetry(operation, options),
    dispose: () => source.dispose(),
  };
}

module.exports = { countedDataSource };
