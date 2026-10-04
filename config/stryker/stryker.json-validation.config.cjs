// @ts-check
const base = require('./stryker.config.cjs');

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
module.exports = {
    ...base,
    ignoreStatic: false,
    mutate: [
        'packages/core/src/json/json-object-inspection.ts',
        'packages/core/src/json/normalize-json-value.ts',
        'packages/core/src/json/json-container-normalizer.ts',
        'packages/core/src/json/json-normalization-state.ts',
    ],
    jest: { ...base.jest, configFile: 'config/jest/jest.json-validation-mutation.config.cjs' },
    htmlReporter: { fileName: 'coverage/mutation-json-validation.html' },
    jsonReporter: { fileName: 'coverage/mutation-json-validation.json' },
    tempDirName: 'temp/stryker-json-validation',
};
