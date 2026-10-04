const base = require('./jest.config.cjs');

module.exports = {
    ...base,
    testMatch: [
        '<rootDir>/tests/migration-primary-key-order.test.ts',
        '<rootDir>/tests/sqlite-join-principal-rename.test.ts',
        '<rootDir>/tests/sqlite-join-planning-boundaries.test.ts',
        '<rootDir>/tests/sqlite-join-source-round-trip.test.ts',
        '<rootDir>/tests/composite-key-many-to-many.test.ts',
        '<rootDir>/tests/store-generation-strategies.test.ts',
    ],
};
