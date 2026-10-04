const base = require('./jest.config.cjs');
module.exports = {
  ...base,
  rootDir: '../..',
  testMatch: [
    '<rootDir>/tests/migration-table-order.test.ts',
    '<rootDir>/tests/migration-table-order-operations.test.ts',
    '<rootDir>/tests/migration-table-order-runtime.test.ts',
    '<rootDir>/tests/migration-table-order-sqlite.test.ts',
    '<rootDir>/tests/migration-foreign-key-inlining.test.ts',
    '<rootDir>/tests/migration-scaffolder.test.ts',
    '<rootDir>/tests/migration-source-compilation.test.ts',
    '<rootDir>/tests/migrations.test.ts',
    '<rootDir>/tests/model-differ-relationships.test.ts',
  ],
};
