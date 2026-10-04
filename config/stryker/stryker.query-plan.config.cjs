// @ts-check
const base=require('./stryker.config.cjs');
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
module.exports={...base,ignoreStatic:false,mutate:['packages/core/src/query/query-plan.ts'],jest:{...base.jest,configFile:'config/jest/jest.query-plan-mutation.config.cjs'},htmlReporter:{fileName:'coverage/mutation-query-plan.html'},jsonReporter:{fileName:'coverage/mutation-query-plan.json'},tempDirName:'temp/stryker-query-plan'};
