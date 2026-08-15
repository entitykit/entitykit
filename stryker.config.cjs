// @ts-check

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
module.exports = {
  mutate: [
    'src/providers/mysql/mysql-value-reader.ts',
    'src/cli/cli-rename-hints.ts',
    'src/tracking/snapshot-value-equality.ts',
    'src/migrations/model-diff-operation-description.ts',
    'src/migrations/migration-column-builder.ts',
    'src/restoration-actions.ts',
    'src/restoration-scope.ts',
    'src/failure-atomic-property-write.ts',
    'src/property-value-restoration.ts',
    'src/core/created-ancestor-restoration.ts',
    // Keep stateful modules focused on their release-critical write/rollback seams.
    'src/core/save-time-mutations.ts:78-101',
    'src/core/save-time-mutations.ts:142-145',
    'src/core/save-time-tenant.ts:57-72',
    'src/core/save-time-tenant.ts:100-112',
    'src/core/bulk-write-tenant.ts:53-64',
    'src/core/bulk-write-tenant.ts:80-83',
    'src/core/unit-of-work/generated-value-writer.ts:87-103',
    'src/core/unit-of-work/tracked-version-acceptance.ts:37-75',
    'src/tracking/change-tracker-detection.ts:85-92',
    'src/tracking/relationship-detection-restore.ts:18-40',
    'src/tracking/tracked-acceptance-journal.ts:53-71',
    'src/materialization/complex-value-materializer.ts:66-78',
    'src/core/policy-property-path.ts:21-36',
    'src/core/save-plan-inspection.ts',
    'src/core/save-plan-builder.ts:43-58',
    'src/core/save-time-writes.ts:43-49',
    'src/core/save-time-relationship-reconciliation.ts:44-70',
    'src/core/save-time-relationship-generation-values.ts:52-59',
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
