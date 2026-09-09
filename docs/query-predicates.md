# Compose query predicates

Query callbacks receive query fields, not entity instances. Field methods
build SQL expressions; composing them executes no SQL.

Successive `where()` calls combine with AND:

```ts
const users = await db.users
  .where(user => user.name.eq(name))
  .where(user => user.email.eq(email))
  .toArray();
```

Use `.and()`, `.or()`, and `.not()` for grouped expressions:

```ts
const users = await db.users.where(user =>
  user.name.eq(name).or(user.email.eq(email))
).toArray();
```

JavaScript `&&` and `||` do not combine predicates. Predicate objects are truthy,
so `left && right` returns only `right`, and `left || right` returns only `left`.
The resulting object is a valid predicate; runtime return-value checks cannot
recover the discarded condition. This applies to joins, filtered includes,
and HAVING predicates too.

For application conditions, use `whereIf()` or conditionally chain `where()`:

```ts
const query = db.users.whereIf(onlyActive, user => user.active.eq(true));
```

## Enable typed linting

EntityKit supports typescript-eslint's `no-unnecessary-condition` rule to
report truthiness checks on predicate objects. It also checks ordinary
TypeScript conditions. Rubric already enables this rule; projects using Rubric
need no additional plugin. The Next.js example enables it with typed parsing.

For another ESLint flat configuration:

```sh
npm install --save-dev eslint typescript typescript-eslint
```

```js
// eslint.config.mjs
import tseslint from "typescript-eslint";

export default [{
  files: ["**/*.ts", "**/*.tsx"],
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
  plugins: { "@typescript-eslint": tseslint.plugin },
  rules: { "@typescript-eslint/no-unnecessary-condition": "error" },
}];
```

Run ESLint in CI as well as the editor. Typed linting needs the application's
`tsconfig.json`; an untyped parser configuration cannot provide this check.
EntityKit's package acceptance tests exercise this configuration against the
installed declarations, including invalid compositions and valid fluent and
conditional queries. Unchecked `any` values can bypass type-aware checks.
