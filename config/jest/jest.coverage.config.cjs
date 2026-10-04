const base = require('./jest.config.cjs');

module.exports = {
  ...base,
  collectCoverage: true,
  // Recycle between suites so V8 inspector state stays bounded on Node 22.
  maxWorkers: 2,
  workerIdleMemoryLimit: '512MiB',
  collectCoverageFrom: ['packages/*/src/**/*.ts'],
  coverageDirectory: 'coverage',
  coverageReporters: ['json-summary', 'html', 'lcov', 'text'],
  testPathIgnorePatterns: ['/tests/integration/', '/node_modules/', '/.claude/'],
};
