const base = require('./jest.config.cjs');

module.exports = {
    ...base,
    testMatch: [
        '<rootDir>/tests/sqlite-main-schema.test.ts',
        '<rootDir>/tests/schema-ddl-capabilities.test.ts',
        '<rootDir>/tests/rich-schema-metadata.test.ts',
        '<rootDir>/tests/migration-provider-ddl.test.ts',
        '<rootDir>/tests/migrations.test.ts',
        '<rootDir>/tests/store-generation-strategies.test.ts',
        '<rootDir>/tests/sqlite-migration-rebuild-safety.test.ts',
        '<rootDir>/tests/sqlite-planning-facets.test.ts',
    ],
};
