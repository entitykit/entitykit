const base = require('./jest.config.cjs');
module.exports = {
    ...base,
    testMatch: [
        '<rootDir>/tests/schema-introspection.test.ts',
        '<rootDir>/tests/postgres-rich-schema-introspection.test.ts',
        '<rootDir>/tests/postgres-column-generation.test.ts',
        '<rootDir>/tests/postgres-numeric-facets.test.ts',
        '<rootDir>/tests/postgres-introspection-values-contract.test.ts',
        '<rootDir>/tests/postgres-schema-facets-contract.test.ts',
    ],
};
