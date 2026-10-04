// @ts-check
const base = require('./stryker.config.cjs');

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
module.exports = {
    ...base,
    mutate: ['packages/core/src/storage/database-provider-validation.ts'],
    htmlReporter: { fileName: 'coverage/mutation-provider-validation.html' },
    jsonReporter: { fileName: 'coverage/mutation-provider-validation.json' },
    tempDirName: 'temp/stryker-provider-validation',
};
