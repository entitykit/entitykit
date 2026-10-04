// @ts-check
const base = require('./stryker.config.cjs');

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
module.exports = {
    ...base,
    mutate: ['packages/sqlite/src/sqlite-ddl-*.ts'],
    jest: { ...base.jest, configFile: 'config/jest/jest.sqlite-ddl-mutation.config.cjs' },
    htmlReporter: { fileName: 'coverage/mutation-sqlite-ddl.html' },
    jsonReporter: { fileName: 'coverage/mutation-sqlite-ddl.json' },
    tempDirName: 'temp/stryker-sqlite-ddl',
};
