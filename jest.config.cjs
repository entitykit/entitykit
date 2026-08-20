/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  coverageProvider: "v8",
  testMatch: ["**/tests/**/*.test.ts"],
  // Workspace package names resolve to package SOURCES so the suite exercises
  // the same files the mutation and coverage gates measure, with no build step.
  moduleNameMapper: {
    "^@entitykit/core$": "<rootDir>/packages/core/src/index.ts",
    "^@entitykit/core/adapter$": "<rootDir>/packages/core/src/adapter/index.ts",
    "^@entitykit/core/experimental$": "<rootDir>/packages/core/src/experimental/index.ts",
    "^@entitykit/core/migrations$": "<rootDir>/packages/core/src/migrations/api.ts",
    "^@entitykit/core/tooling$": "<rootDir>/packages/core/src/tooling/index.ts",
    "^@entitykit/cli$": "<rootDir>/packages/cli/src/api.ts",
    "^@entitykit/mysql$": "<rootDir>/packages/mysql/src/index.ts",
    "^@entitykit/postgres$": "<rootDir>/packages/postgres/src/index.ts",
    "^@entitykit/sqlite$": "<rootDir>/packages/sqlite/src/index.ts",
    "^@entitykit/testing$": "<rootDir>/packages/testing/src/index.ts",
    "^entitykit/migrations$": "<rootDir>/packages/core/src/migrations/api.ts"
  }
};
