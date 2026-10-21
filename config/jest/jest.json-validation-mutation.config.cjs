const base = require('./jest.config.cjs');

module.exports = {
    ...base,
    testMatch: [
        '<rootDir>/tests/json-value.test.ts',
        '<rootDir>/tests/json-value-sqlite.test.ts',
        '<rootDir>/tests/outbox-json-contract.test.ts',
        '<rootDir>/tests/json-object-inspection.test.ts',
        '<rootDir>/tests/json-descriptor-snapshot.test.ts',
        '<rootDir>/tests/json-normalization-contract.test.ts',
        '<rootDir>/tests/json-traversal-state.test.ts',
        '<rootDir>/tests/json-normalization-property-writes.test.ts',
        '<rootDir>/tests/json-serialization-snapshot.test.ts',
        '<rootDir>/tests/json-key-escaping-observations.test.ts',
        '<rootDir>/tests/json-diagnostics-sqlite.test.ts',
    ],
};
