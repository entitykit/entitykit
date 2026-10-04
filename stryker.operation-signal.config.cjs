// @ts-check
const base = require('./stryker.config.cjs');

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
module.exports = {
    ...base,
    ignoreStatic: false,
    mutate: ['packages/core/src/storage/with-operation-signal.ts'],
    jest: { ...base.jest, configFile: 'jest.operation-signal-mutation.config.cjs' },
    htmlReporter: { fileName: 'coverage/mutation-operation-signal.html' },
    jsonReporter: { fileName: 'coverage/mutation-operation-signal.json' },
    tempDirName: 'temp/stryker-operation-signal',
};
