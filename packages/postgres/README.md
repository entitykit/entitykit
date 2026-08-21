# @entitykit/postgres

**Postgres for EntityKit, using `pg`.**

The package provides pooled connections, schema introspection, query helpers,
and Postgres dialects. Core never loads `pg` unless a context selects Postgres.

## Install

```sh
npm install @entitykit/core@alpha @entitykit/postgres@alpha pg
```

## Configure

```ts
import { DbContext, type DbContextOptionsBuilder } from "@entitykit/core";

class AppDbContext extends DbContext {
  protected override configure(options: DbContextOptionsBuilder): void {
    options.usePostgres(process.env.DATABASE_URL ?? "");
  }
}
```

The package also exports `postgresProviderServices` for explicit provider
registration. `@entitykit/core` and `pg` are peer dependencies.

See the [project README](https://github.com/entitykit/entitykit#readme) for the
complete model and alpha boundaries.
