const base = require('./jest.config.cjs');

module.exports = {
    ...base,
    testMatch: [
        '<rootDir>/tests/postgres-rich-schema-introspection.test.ts',
        '<rootDir>/tests/schema-introspection.test.ts',
        '<rootDir>/tests/postgres-column-generation.test.ts',
    ],
};
