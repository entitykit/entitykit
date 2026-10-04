// @ts-check
const base = require('./stryker.config.cjs');

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
module.exports = {
    ...base,
    ignoreStatic: false,
    mutate: [
        'packages/core/src/migrations/model-diff-sqlite-rebuild.ts',
        'packages/core/src/migrations/model-diff-sqlite-rebuild-copy.ts',
        'packages/core/src/migrations/model-diff-rebuild-group.ts',
    ],
    jest: { ...base.jest, configFile: 'config/jest/jest.sqlite-planning-mutation.config.cjs' },
    htmlReporter: { fileName: 'coverage/mutation-sqlite-planning.html' },
    jsonReporter: { fileName: 'coverage/mutation-sqlite-planning.json' },
    tempDirName: 'temp/stryker-sqlite-planning',
};
