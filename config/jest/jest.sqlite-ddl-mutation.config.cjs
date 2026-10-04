const base = require('./jest.config.cjs');

module.exports = {
    ...base,
    testMatch: [
        '<rootDir>/tests/sqlite-ddl-fragments.test.ts',
        '<rootDir>/tests/sqlite-ddl-parser-boundaries.test.ts',
        '<rootDir>/tests/sqlite-ddl-lexical-boundaries.test.ts',
        '<rootDir>/tests/sqlite-expression-collation-roundtrip.test.ts',
        '<rootDir>/tests/sqlite-schema-introspection.test.ts',
        '<rootDir>/tests/sqlite-db-pull-roundtrip.test.ts',
        '<rootDir>/tests/sqlite-check-default-roundtrip.test.ts',
    ],
};
