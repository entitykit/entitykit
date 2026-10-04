// @ts-check
const base = require('./stryker.config.cjs');

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
module.exports = {
    ...base,
    ignoreStatic: false,
    mutate: ['packages/postgres/src/postgres-column-generation.ts'],
    jest: { ...base.jest, configFile: 'config/jest/jest.postgres-generation-mutation.config.cjs' },
    htmlReporter: { fileName: 'coverage/mutation-postgres-generation.html' },
    jsonReporter: { fileName: 'coverage/mutation-postgres-generation.json' },
    tempDirName: 'temp/stryker-postgres-generation',
};
