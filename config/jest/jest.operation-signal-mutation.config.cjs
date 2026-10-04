const base = require('./jest.config.cjs');

module.exports = {
    ...base,
    testMatch: [
        '<rootDir>/tests/cli-cancellation.test.ts',
        '<rootDir>/tests/operation-signal-wrapper.test.ts',
        '<rootDir>/tests/operation-signal-sqlite.test.ts',
    ],
};
