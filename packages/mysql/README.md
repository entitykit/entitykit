# @entitykit/mysql

**MySQL for EntityKit, using `mysql2`.**

The package provides pooled connections, schema introspection, and MySQL
dialects. Core never loads `mysql2` unless a context selects MySQL.

## Install

```sh
npm install @entitykit/core@alpha @entitykit/mysql@alpha mysql2
```

## Configure

```ts
import { DbContext, type DbContextOptionsBuilder } from "@entitykit/core";

class AppDbContext extends DbContext {
  protected override configure(options: DbContextOptionsBuilder): void {
    options.useMySql(process.env.DATABASE_URL ?? "");
  }
}
```

The package also exports `mySqlProviderServices` for explicit provider
registration. `@entitykit/core` and `mysql2` are peer dependencies.

See the [project README](https://github.com/entitykit/entitykit#readme) for the
complete model and alpha boundaries.
