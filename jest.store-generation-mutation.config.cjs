const base = require('./jest.config.cjs');

module.exports = {
    ...base,
    testMatch: [
        '<rootDir>/tests/store-generation-strategies.test.ts',
        '<rootDir>/tests/rich-schema-metadata.test.ts',
        '<rootDir>/tests/sequence-identifier-preservation.test.ts',
        '<rootDir>/tests/model-synchronous-contract.test.ts',
        '<rootDir>/tests/property-generation-validation.test.ts',
        '<rootDir>/tests/store-generation-options.test.ts',
        '<rootDir>/tests/sequence-option-validation.test.ts',
    ],
};
