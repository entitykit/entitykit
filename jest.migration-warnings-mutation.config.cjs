const base = require('./jest.config.cjs');

module.exports = {
    ...base,
    testMatch: [
        '<rootDir>/tests/migration-warning-metadata.test.ts',
        '<rootDir>/tests/migration-scaffolder.test.ts',
        '<rootDir>/tests/migration-update-plan.test.ts',
        '<rootDir>/tests/migration-runner-update/history-validation.test.ts',
        '<rootDir>/tests/migration-runner-update/safety-and-transactions.test.ts',
    ],
};
