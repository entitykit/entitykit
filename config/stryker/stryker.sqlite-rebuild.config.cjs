// @ts-check
const base = require('./stryker.config.cjs');

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
module.exports = {
    ...base,
    ignoreStatic: false,
    mutate: [
        'packages/sqlite/src/sqlite-migration-transaction.ts',
        'packages/core/src/migrations/runner/migration-executor.ts',
    ],
    jest: { ...base.jest, configFile: 'config/jest/jest.sqlite-rebuild-mutation.config.cjs' },
    htmlReporter: { fileName: 'coverage/mutation-sqlite-rebuild.html' },
    jsonReporter: { fileName: 'coverage/mutation-sqlite-rebuild.json' },
    tempDirName: 'temp/stryker-sqlite-rebuild',
};
