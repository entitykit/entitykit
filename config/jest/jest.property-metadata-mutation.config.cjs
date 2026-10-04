const base = require('./jest.config.cjs');

module.exports = {
    ...base,
    testMatch: [
        '<rootDir>/tests/property-generation-validation.test.ts',
        '<rootDir>/tests/store-generation-strategies.test.ts',
        '<rootDir>/tests/entity-property-role-validation.test.ts',
        '<rootDir>/tests/rich-schema-metadata.test.ts',
        '<rootDir>/tests/optimistic-concurrency-metadata.test.ts',
        '<rootDir>/tests/model-polish.test.ts',
        '<rootDir>/tests/complex-property-model.test.ts',
    ],
};
