# @entitykit/core

The EntityKit runtime: `DbContext`, fluent model mapping, typed queries, change
tracking, materialization, migrations, and the `defineEntityKitConfig` API that
a project's `entitykit.config.ts` imports. Core carries no database driver — add
a provider package (`@entitykit/sqlite`, `@entitykit/postgres`, or
`@entitykit/mysql`) for the database you use. Subpaths cover the rest:
`@entitykit/core/migrations` for migration authoring, `@entitykit/core/adapter`
for custom-provider contracts, `@entitykit/core/tooling` for introspection and
code generation, and `@entitykit/core/experimental` for unstable internals.

```bash
npm install @entitykit/core@alpha
```

```ts
import { DbContext, type DbContextOptionsBuilder } from "@entitykit/core";
```

See the [EntityKit repository README](../../README.md) for the project
overview, installation, and documentation.
