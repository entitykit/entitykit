import rubric from "eslint-config-rubric";

export default [
  { ignores: ["tests/fixtures/package-consumer/**"] },
  ...rubric,
];
