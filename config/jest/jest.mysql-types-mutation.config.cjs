const base = require('./jest.config.cjs');

module.exports = {
    ...base,
    testMatch: [
        '<rootDir>/tests/schema-mysql-foreign-keys.test.ts',
        '<rootDir>/tests/mysql-introspection-metadata.test.ts',
        '<rootDir>/tests/schema-introspection.test.ts',
        '<rootDir>/tests/db-pull-codegen/mysql.test.ts',
        '<rootDir>/tests/mysql-column-type.test.ts',
        '<rootDir>/tests/mysql-type-literal-introspection.test.ts',
        '<rootDir>/tests/mysql-snapshot-contract.test.ts',
    ],
};
