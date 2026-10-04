const base = require('./stryker.config.cjs');
module.exports = {
  ...base,
  ignoreStatic: false,
  mutate: ['packages/core/src/materialization/checked-scalar-value.ts'],
  jest: { ...base.jest, configFile: 'config/jest/jest.checked-scalar.config.cjs' },
  htmlReporter: { fileName: 'coverage/mutation-checked-scalar.html' },
  jsonReporter: { fileName: 'coverage/mutation-checked-scalar.json' },
  tempDirName: 'temp/stryker-checked-scalar',
};
