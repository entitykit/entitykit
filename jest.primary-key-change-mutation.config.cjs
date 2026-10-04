const base = require('./jest.config.cjs');

module.exports = {
    ...base,
    testMatch: [
        '<rootDir>/tests/migration-primary-key-change.test.ts',
        '<rootDir>/tests/migration-primary-key-order.test.ts',
        '<rootDir>/tests/sqlite-planning-facets.test.ts',
        '<rootDir>/tests/sqlite-join-principal-rename.test.ts',
        '<rootDir>/tests/sqlite-join-source-round-trip.test.ts',
        '<rootDir>/tests/model-differ-columns.test.ts',
        '<rootDir>/tests/model-differ-relationships.test.ts',
    ],
};
