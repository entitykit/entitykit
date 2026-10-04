const base = require('./jest.config.cjs');
module.exports = {
  ...base,
  testMatch: [
    '<rootDir>/tests/one-to-one-index-model.test.ts',
    '<rootDir>/tests/one-to-one-index-name-collision-sqlite.test.ts',
    '<rootDir>/tests/index-name-validation.test.ts',
    '<rootDir>/tests/model-snapshot.test.ts',
    '<rootDir>/tests/one-to-one-index-enforcement-sqlite.test.ts',
    '<rootDir>/tests/index-uniqueness-metadata-contract.test.ts',
    '<rootDir>/tests/one-to-one.test.ts',
    '<rootDir>/tests/rich-schema-metadata.test.ts',
    '<rootDir>/tests/model-misconfiguration.test.ts',
    '<rootDir>/tests/mixed-index-model.test.ts',
    '<rootDir>/tests/alternate-key*.test.ts',
    '<rootDir>/tests/composite-key*.test.ts',
  ],
};
