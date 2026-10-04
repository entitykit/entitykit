// @ts-check
const base = require('./stryker.config.cjs');

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
module.exports = {
    ...base,
    ignoreStatic: false,
    mutate: ['packages/core/src/migrations/migration-destructive-warnings.ts'],
    jest: { ...base.jest, configFile: 'jest.migration-warnings-mutation.config.cjs' },
    htmlReporter: { fileName: 'coverage/mutation-migration-warnings.html' },
    jsonReporter: { fileName: 'coverage/mutation-migration-warnings.json' },
    tempDirName: 'temp/stryker-migration-warnings',
};
