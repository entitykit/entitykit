// @ts-check
const base = require('./stryker.config.cjs');

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
module.exports = {
    ...base,
    ignoreStatic: false,
    mutate: [
        'packages/sqlite/src/sqlite-schema-ddl.ts',
        'packages/core/src/sql/ddl-table-reference.ts',
        'packages/core/src/schema/schema-statements.ts',
    ],
    jest: { ...base.jest, configFile: 'config/jest/jest.schema-ddl-mutation.config.cjs' },
    htmlReporter: { fileName: 'coverage/mutation-schema-ddl.html' },
    jsonReporter: { fileName: 'coverage/mutation-schema-ddl.json' },
    tempDirName: 'temp/stryker-schema-ddl',
};
