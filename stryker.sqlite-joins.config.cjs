// @ts-check
const base = require('./stryker.config.cjs');

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
module.exports = {
    ...base,
    ignoreStatic: false,
    mutate: [
        'packages/core/src/migrations/model-diff-sqlite-join-rebuild.ts',
        'packages/core/src/migrations/model-diff-join-table-definition.ts',
        'packages/core/src/migrations/model-diff-join-table-detector.ts',
        'packages/core/src/migrations/model-diff-join-table-rollback.ts',
    ],
    jest: { ...base.jest, configFile: 'jest.sqlite-joins-mutation.config.cjs' },
    htmlReporter: { fileName: 'coverage/mutation-sqlite-joins.html' },
    jsonReporter: { fileName: 'coverage/mutation-sqlite-joins.json' },
    tempDirName: 'temp/stryker-sqlite-joins',
};
