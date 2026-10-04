const base = require('./jest.config.cjs');

module.exports = {
    ...base,
    testMatch: [
        '<rootDir>/tests/sqlite-planning-facets.test.ts',
        '<rootDir>/tests/sqlite-planning-renames.test.ts',
        '<rootDir>/tests/sqlite-principal-column-rename.test.ts',
        '<rootDir>/tests/sqlite-migration-rebuild-safety.test.ts',
        '<rootDir>/tests/snapshot-rename-references.test.ts',
        '<rootDir>/tests/model-differ-columns.test.ts',
        '<rootDir>/tests/model-differ-relationships.test.ts',
        '<rootDir>/tests/composite-key-migrations.test.ts',
        '<rootDir>/tests/migrations.test.ts',
        '<rootDir>/tests/migration-source-compilation.test.ts',
    ],
};
