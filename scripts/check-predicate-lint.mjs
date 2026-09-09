import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';

// Exercise the supported rule against a consumer of the actual packed types.
const project = path.resolve(process.argv[2]);
const file = path.join(project, 'predicate-lint.ts');
const expected = fs.readFileSync(file, 'utf8').split('\n').flatMap((line, index) =>
  line.includes('// expect-predicate-error') ? [index + 1] : []);
assert(expected.length > 0, 'The predicate lint fixture must contain misuse cases.');
const rule = '@typescript-eslint/no-unnecessary-condition';
const eslint = new ESLint({
  cwd: project,
  overrideConfigFile: true,
  overrideConfig: [{
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.predicates.json',
        tsconfigRootDir: project,
      },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: { [rule]: 'error' },
  }],
});
const [result] = await eslint.lintFiles([file]);
assert.deepEqual(result.messages.map(message => ({
  line: message.line, rule: message.ruleId, severity: message.severity,
})), expected.map(line => ({ line, rule, severity: 2 })), JSON.stringify(result.messages));
process.stdout.write(`PACKAGE_PREDICATE_LINT_OK ${expected.length} misuse cases\n`);
