const base = require('./jest.config.cjs');
module.exports = { ...base, testMatch: [
    '<rootDir>/tests/rich-schema-metadata.test.ts',
    '<rootDir>/tests/model-misconfiguration.test.ts',
    '<rootDir>/tests/model-snapshot.test.ts',
    '<rootDir>/tests/db-pull-codegen/model-mapping.test.ts',
    '<rootDir>/tests/db-pull-codegen/lossy-schema.test.ts',
    '<rootDir>/tests/db-pull-mixed-index.test.ts',
    '<rootDir>/tests/mixed-index-model.test.ts',
    '<rootDir>/tests/mixed-index-sqlite.test.ts',
    '<rootDir>/tests/db-pull-index-emitter-contract.test.ts',
    '<rootDir>/tests/db-pull-codegen/foreign-keys.test.ts',
] };
