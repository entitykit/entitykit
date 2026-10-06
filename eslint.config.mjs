import rubric from "eslint-config-rubric";

export default [
  {
    ignores: [
      "examples/**",
      "tests/fixtures/package-consumer/**",
      "packages/*/dist/**",
    ],
  },
  ...rubric,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      // An underscore identifies a deliberately unused hook argument or type-test value.
      // Flag its use so this convention cannot conceal ordinary unused code.
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        reportUsedIgnorePattern: true,
      }],
    },
  },
];
