// @ts-check
const base = require('./stryker.config.cjs');
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
module.exports = {
    ...base,
    ignoreStatic: false,
    mutate: [
        'packages/postgres/src/postgres-introspection-values.ts',
        'packages/postgres/src/postgres-schema-facets.ts',
    ],
    jest: { ...base.jest, configFile: 'config/jest/jest.postgres-schema-values-mutation.config.cjs' },
    htmlReporter: { fileName: 'coverage/mutation-postgres-schema-values.html' },
    jsonReporter: { fileName: 'coverage/mutation-postgres-schema-values.json' },
    tempDirName: 'temp/stryker-postgres-schema-values',
};
