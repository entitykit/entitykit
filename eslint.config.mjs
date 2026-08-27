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
];
