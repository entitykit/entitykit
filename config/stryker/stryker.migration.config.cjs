// @ts-check
const base = require('./stryker.config.cjs');

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
module.exports = {
  ...base,
  mutate: [
    'packages/core/src/migrations/runner/migration-lock-operation.ts',
    'packages/core/src/migrations/runner/migration-update-lock.ts',
    'packages/core/src/migrations/runner/read-migration-history.ts:16-35',
    'packages/core/src/migrations/migration-runner.ts:98-105',
    'packages/core/src/migrations/migration-runner.ts:116-124',
    'packages/core/src/migrations/migration-runner.ts:131-133',
    'packages/core/src/migrations/runner/migration-update-runner.ts:35-40',
    'packages/core/src/migrations/runner/migration-update-runner.ts:63-68',
    'packages/core/src/migrations/runner/migration-update-runner.ts:119-124',
  ],
  jest: {
    ...base.jest,
    configFile: 'config/jest/jest.migration-mutation.config.cjs',
  },
  htmlReporter: { fileName: 'coverage/mutation-migrations.html' },
  jsonReporter: { fileName: 'coverage/mutation-migrations.json' },
  tempDirName: 'temp/stryker-migrations',
};
