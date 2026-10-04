// @ts-check
const base = require('./stryker.config.cjs');
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
module.exports = {
  ...base,
  ignoreStatic: false,
  mutate: [
    'packages/core/src/schema/table-column-statement.ts',
    'packages/core/src/migrations/migration-builder-column-render.ts',
    // Qualify the entire history-table creation method added to this repair.
    'packages/sqlite/src/sqlite-dialect.ts:108-113',
  ],
  jest: { ...base.jest, configFile: 'config/jest/jest.required-primary-key.config.cjs' },
  htmlReporter: { fileName: 'coverage/mutation-required-primary-key.html' },
  jsonReporter: { fileName: 'coverage/mutation-required-primary-key.json' },
  tempDirName: 'temp/stryker-required-primary-key',
};
