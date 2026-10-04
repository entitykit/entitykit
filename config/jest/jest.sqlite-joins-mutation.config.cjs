const base = require('./jest.config.cjs');

module.exports = {
    ...base,
    testMatch: [
        '<rootDir>/tests/sqlite-join-principal-rename.test.ts',
        '<rootDir>/tests/sqlite-join-planning-boundaries.test.ts',
        '<rootDir>/tests/sqlite-join-source-round-trip.test.ts',
        '<rootDir>/tests/composite-key-many-to-many.test.ts',
        '<rootDir>/tests/sqlite-principal-column-rename.test.ts',
        '<rootDir>/tests/sqlite-main-schema.test.ts',
        '<rootDir>/tests/rich-schema-metadata.test.ts',
        '<rootDir>/tests/migrations.test.ts',
        '<rootDir>/tests/migration-source-compilation.test.ts',
    ],
};
