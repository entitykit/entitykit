const base = require('./jest.config.cjs');
module.exports = {
  ...base,
  testMatch: [
    '<rootDir>/tests/checked-scalar-value.test.ts',
    '<rootDir>/tests/checked-materialization.test.ts',
    '<rootDir>/tests/checked-materialization-sqlite.test.ts',
    '<rootDir>/tests/checked-timestamp-sqlite.test.ts',
  ],
};
