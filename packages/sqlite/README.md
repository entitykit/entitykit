# @entitykit/sqlite

**SQLite for EntityKit, using Node's built-in driver.**

The provider uses `node:sqlite` and needs no native dependency. Core loads it
only when a context selects SQLite.

## Install

```sh
npm install @entitykit/core@alpha @entitykit/sqlite@alpha
```

## Configure

```ts
import { DbContext, type DbContextOptionsBuilder } from "@entitykit/core";

class AppDbContext extends DbContext {
  protected override configure(options: DbContextOptionsBuilder): void {
    options.useSqlite("./app.db");
  }
}
```

The package also exports `sqliteProviderServices`, the SQLite dialect and
connection, and a `rawSql` tag for standalone statements. `node:sqlite` is
available without a command-line flag from Node 22.13 onward; some 22.x
releases still print an informational `ExperimentalWarning` when it loads.

See the [project README](https://github.com/entitykit/entitykit#readme) for the
complete model and alpha boundaries.
