const base=require('./jest.config.cjs');
module.exports={...base,testMatch:[
 '<rootDir>/tests/sql-observability.test.ts',
 '<rootDir>/tests/include-query-model.test.ts',
 '<rootDir>/tests/query-plan-contract.test.ts',
]};
