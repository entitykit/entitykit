const base = require('./jest.config.cjs');

module.exports = {
    ...base,
    testMatch: [
        '<rootDir>/tests/sqlite-migration-rebuild-safety.test.ts',
        '<rootDir>/tests/sqlite-migration-rebuild-lifecycle.test.ts',
        '<rootDir>/tests/migration-transaction-hooks.test.ts',
        '<rootDir>/tests/migration-runner-update/*.test.ts',
        '<rootDir>/tests/mysql-migration-transactions.test.ts',
        '<rootDir>/tests/diagnostics/save-and-migration-diagnostics.test.ts',
    ],
};
