// @ts-check
const base = require('./stryker.config.cjs');

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
module.exports = {
    ...base,
    ignoreStatic: false,
    mutate: [
        'packages/core/src/model/store-generation.ts',
        'packages/core/src/model/sequence-builder.ts',
        'packages/core/src/model/property-store-generation.ts',
    ],
    jest: { ...base.jest, configFile: 'config/jest/jest.store-generation-mutation.config.cjs' },
    htmlReporter: { fileName: 'coverage/mutation-store-generation.html' },
    jsonReporter: { fileName: 'coverage/mutation-store-generation.json' },
    tempDirName: 'temp/stryker-store-generation',
};
