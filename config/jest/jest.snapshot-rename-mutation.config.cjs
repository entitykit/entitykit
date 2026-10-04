const base = require('./jest.config.cjs');

module.exports = {
    ...base,
    testMatch: ['<rootDir>/tests/snapshot-rename-references.test.ts'],
};
