// @ts-check

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
module.exports = {
  mutate: [
    'src/providers/mysql/mysql-value-reader.ts',
    'src/cli/cli-rename-hints.ts',
    'src/tracking/snapshot-value-equality.ts',
    'src/migrations/model-diff-operation-description.ts',
    'src/migrations/migration-column-builder.ts',
  ],
  testRunner: 'jest',
  jest: {
    projectType: 'custom',
    configFile: 'jest.mutation.config.cjs',
    enableFindRelatedTests: true,
  },
  coverageAnalysis: 'perTest',
  ignoreStatic: true,
  concurrency: 2,
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: {
    fileName: 'coverage/mutation.html',
  },
  jsonReporter: {
    fileName: 'coverage/mutation.json',
  },
  thresholds: {
    high: 95,
    low: 90,
    break: 90,
  },
  tempDirName: 'temp/stryker',
  timeoutMS: 10_000,
};
