<p align="center">
  <img src="https://raw.githubusercontent.com/entitykit/entitykit/main/entitykit-logo.svg" alt="EntityKit" width="560">
</p>

<h1 align="center">@entitykit/sqlite</h1>

<p align="center"><strong>SQLite for EntityKit, using Node's built-in driver.</strong></p>

<p align="center">
  <a href="https://github.com/entitykit/entitykit/blob/main/USAGE.md">Usage</a>
  <span> · </span>
  <a href="https://github.com/entitykit/entitykit/blob/main/API.md">API</a>
  <span> · </span>
  <a href="https://github.com/entitykit/entitykit/blob/main/docs/compatibility.md">Compatibility</a>
</p>

The provider uses `node:sqlite`: no native addon or separate database driver is
required. Core loads it only when a context selects SQLite.

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

Use `":memory:"` for an isolated in-memory database:

```ts
options.useSqlite(":memory:");
```

Typed configuration also supports read-only access, foreign-key enforcement,
busy timeout, and journal mode.

## Direct provider API

The package exports `sqliteProviderServices`, `createSqliteDataSource`,
`SqliteDatabaseConnection`, `SqliteSchemaIntrospector`, SQLite runtime and
migration dialects, the SQLite value reader, and a standalone parameterized
`rawSql` tag.

```ts
import { sqliteProviderServices } from "@entitykit/sqlite";

options.useProvider(sqliteProviderServices, { filename: "./app.db" });
```

## Boundaries

EntityKit requires Node 22.13 or newer. Some Node 22 releases still print an
informational `ExperimentalWarning` when `node:sqlite` loads.

SQLite migration changes that cannot be expressed with `ALTER TABLE` use a
modeled table rebuild. SQLite has no migration advisory lock and supports only
`serializable` and `readUncommitted` isolation through EntityKit. Review the
complete [provider boundary](https://github.com/entitykit/entitykit/blob/main/docs/compatibility.md#sqlite).

## License

MIT
