// @ts-check
const base = require('./stryker.config.cjs');

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
module.exports = {
    ...base,
    mutate: ['packages/core/src/migrations/migration-checksum-payload.ts'],
    jest: { ...base.jest, configFile: 'jest.checksum-mutation.config.cjs' },
    htmlReporter: { fileName: 'coverage/mutation-checksum.html' },
    jsonReporter: { fileName: 'coverage/mutation-checksum.json' },
    tempDirName: 'temp/stryker-checksum',
};
