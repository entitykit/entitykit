const base = require('./jest.config.cjs');

module.exports = {
  ...base,
  collectCoverage: true,
  collectCoverageFrom: ['packages/*/src/**/*.ts'],
  coverageDirectory: 'coverage',
  coverageReporters: ['json-summary', 'html', 'lcov', 'text'],
  testPathIgnorePatterns: ['/tests/integration/', '/node_modules/', '/.claude/'],
};
