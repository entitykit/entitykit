// @ts-check
const base = require('./stryker.config.cjs');
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
module.exports = {
  ...base,
  ignoreStatic: false,
  mutate: [
    'packages/core/src/migrations/migration-operation-renderer.ts',
    'packages/core/src/migrations/model-diff-foreign-key-inlining.ts',
    'packages/core/src/migrations/migration-table-order.ts',
    'packages/core/src/migrations/model-diff-migrations.ts',
  ],
  jest: { ...base.jest, configFile: 'config/stryker/jest.migration-table-order.config.cjs' },
  htmlReporter: { fileName: 'coverage/mutation-migration-table-order.html' },
  jsonReporter: { fileName: 'coverage/mutation-migration-table-order.json' },
  tempDirName: 'temp/stryker-migration-table-order',
};
