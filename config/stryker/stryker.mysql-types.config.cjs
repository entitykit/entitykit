// @ts-check
const base = require('./stryker.config.cjs');

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
module.exports = {
    ...base,
    ignoreStatic: false,
    mutate: [
        'packages/mysql/src/mysql-column-type.ts',
        'packages/mysql/src/mysql-introspect-snapshot.ts',
    ],
    jest: { ...base.jest, configFile: 'config/jest/jest.mysql-types-mutation.config.cjs' },
    htmlReporter: { fileName: 'coverage/mutation-mysql-types.html' },
    jsonReporter: { fileName: 'coverage/mutation-mysql-types.json' },
    tempDirName: 'temp/stryker-mysql-types',
};
