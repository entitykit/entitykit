const base = require('./jest.config.cjs');

module.exports = {
  ...base,
  testMatch: [
    '<rootDir>/tests/mysql-value-reader.test.ts',
    '<rootDir>/tests/cli-rename-hints.test.ts',
    '<rootDir>/tests/snapshot-value-equality.test.ts',
    '<rootDir>/tests/model-diff-operation-description.test.ts',
    '<rootDir>/tests/migration-column-builder.test.ts',
  ],
};
