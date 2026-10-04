const base = require('./stryker.config.cjs');
module.exports = {
  ...base,
  ignoreStatic: false,
  mutate: [
    'packages/core/src/model/index-metadata-finalizer.ts',
    'packages/core/src/model/alternate-key-indexes.ts',
  ],
  jest: { ...base.jest, configFile: 'config/jest/jest.relationship-index.config.cjs' },
  htmlReporter: { fileName: 'coverage/mutation-relationship-index.html' },
  jsonReporter: { fileName: 'coverage/mutation-relationship-index.json' },
  tempDirName: 'temp/stryker-relationship-index',
};
