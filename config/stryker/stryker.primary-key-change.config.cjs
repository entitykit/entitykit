// @ts-check
const base = require('./stryker.config.cjs');

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
module.exports = {
    ...base,
    ignoreStatic: false,
    mutate: ['packages/core/src/migrations/model-diff-primary-key-order.ts'],
    jest: { ...base.jest, configFile: 'config/jest/jest.primary-key-change-mutation.config.cjs' },
    htmlReporter: { fileName: 'coverage/mutation-primary-key-change.html' },
    jsonReporter: { fileName: 'coverage/mutation-primary-key-change.json' },
    tempDirName: 'temp/stryker-primary-key-change',
};
