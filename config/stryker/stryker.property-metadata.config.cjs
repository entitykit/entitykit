// @ts-check
const base = require('./stryker.config.cjs');

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
module.exports = {
    ...base,
    ignoreStatic: false,
    mutate: ['packages/core/src/model/property-metadata-finalizer.ts'],
    jest: { ...base.jest, configFile: 'config/jest/jest.property-metadata-mutation.config.cjs' },
    htmlReporter: { fileName: 'coverage/mutation-property-metadata.html' },
    jsonReporter: { fileName: 'coverage/mutation-property-metadata.json' },
    tempDirName: 'temp/stryker-property-metadata',
};
