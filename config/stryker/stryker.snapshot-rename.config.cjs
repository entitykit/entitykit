// @ts-check
const base = require('./stryker.config.cjs');

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
module.exports = {
    ...base,
    ignoreStatic: false,
    mutate: ['packages/core/src/migrations/model-snapshot-property-rename.ts'],
    jest: { ...base.jest, configFile: 'config/jest/jest.snapshot-rename-mutation.config.cjs' },
    htmlReporter: { fileName: 'coverage/mutation-snapshot-rename.html' },
    jsonReporter: { fileName: 'coverage/mutation-snapshot-rename.json' },
    tempDirName: 'temp/stryker-snapshot-rename',
};
