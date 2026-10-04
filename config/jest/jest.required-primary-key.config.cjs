const base = require('../../jest.config.cjs');
module.exports = {
  ...base,
  rootDir: '../..',
  testMatch: [
    '<rootDir>/tests/required-primary-key-ddl.test.ts',
    '<rootDir>/tests/required-primary-key-sqlite.test.ts',
    '<rootDir>/tests/schema-sql-builder.test.ts',
    '<rootDir>/tests/schema-sql-builder-advanced.test.ts',
    '<rootDir>/tests/rich-schema-metadata.test.ts',
    '<rootDir>/tests/store-generation-strategies.test.ts',
    '<rootDir>/tests/store-generation-options.test.ts',
    '<rootDir>/tests/migration-primary-key-order.test.ts',
    '<rootDir>/tests/migrations.test.ts',
    '<rootDir>/tests/sqlite-main-schema.test.ts',
  ],
};
