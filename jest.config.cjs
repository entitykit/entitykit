/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  coverageProvider: "v8",
  testMatch: ["**/tests/**/*.test.ts"],
  moduleNameMapper: {
    "^entitykit/migrations$": "<rootDir>/src/migrations/api.ts"
  }
};
