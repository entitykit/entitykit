// @ts-check
const base = require('./stryker.config.cjs');
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
module.exports = {
    ...base, ignoreStatic: false,
    mutate: [
        'packages/core/src/model/entity-builder-keys.ts',
        'packages/core/src/model/index-key-parts.ts',
        'packages/core/src/introspection/db-pull-index-config-emitter.ts',
    ],
    jest: { ...base.jest, configFile: 'config/jest/jest.mixed-index-mutation.config.cjs' },
    htmlReporter: { fileName: 'coverage/mutation-mixed-index.html' },
    jsonReporter: { fileName: 'coverage/mutation-mixed-index.json' },
    tempDirName: 'temp/stryker-mixed-index',
};
