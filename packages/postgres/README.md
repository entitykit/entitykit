# @entitykit/postgres

The Postgres provider for EntityKit, backed by the `pg` driver. It carries the
concrete Postgres services, pooled connection, schema introspector, query
helpers, and dialects; core never re-exports any of it, so a project that never
uses Postgres never loads `pg`. Register it with
`options.usePostgres(connectionString)` or pass its services to
`options.useProvider(...)`.

```bash
npm install @entitykit/core@alpha @entitykit/postgres@alpha pg
```

```ts
import { postgresProviderServices } from "@entitykit/postgres";
```

`@entitykit/core` and `pg` are peer dependencies. See the
[EntityKit repository README](../../README.md) for the project overview,
installation, and documentation.
