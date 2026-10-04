const base = require('./jest.config.cjs');

module.exports = {
    ...base,
    testMatch: [
        '<rootDir>/tests/migration-checksum.test.ts',
        '<rootDir>/tests/migration-checksum-value-boundaries.test.ts',
        '<rootDir>/tests/migration-runner-update/dialect-and-checksum.test.ts',
    ],
};
