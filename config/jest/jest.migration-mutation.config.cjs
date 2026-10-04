const base = require('./jest.config.cjs');

module.exports = {
  ...base,
  testMatch: [
    '<rootDir>/tests/migration-history-bootstrap-lock.test.ts',
    '<rootDir>/tests/migration-history-read.test.ts',
    '<rootDir>/tests/migration-lock-lifecycle.test.ts',
    '<rootDir>/tests/migration-active-transaction.test.ts',
    '<rootDir>/tests/migration-runner-update/*.test.ts',
    '<rootDir>/tests/mysql-migration-lock.test.ts',
    '<rootDir>/tests/migration-synchronous-sqlite.test.ts',
    '<rootDir>/tests/migration-index-provider-rules.test.ts',
  ],
};
