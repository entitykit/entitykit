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

> [!IMPORTANT]
> This README describes `0.1.0-alpha.2`. With the previous `0.1.0-alpha.1`,
> select the shared source explicitly with `options.useDataSource(source)` in
> `configure()`.

## Application data source

```ts
import { DbContext } from "@entitykit/core";
import { createSqliteDataSource } from "@entitykit/sqlite";

class AppDbContext extends DbContext {}

const dataSource = createSqliteDataSource("./app.db");

const db = dataSource.createContext(AppDbContext);
try {
  // Await one request, job, or other unit of work through db.
} finally {
  await db.dispose();
}

// Application shutdown, after every context has been disposed:
await dataSource.dispose();
```

Create the source once for the application, create and dispose a fresh context
for each unit of work, then dispose the source during application shutdown.
`DbContext` accepts the source through its optional constructor, so a
source-backed context does not need provider configuration.

Use `":memory:"` for a single-context isolated database:

```ts
const dataSource = createSqliteDataSource(":memory:");
```

Each context leased from that source opens a distinct in-memory database, so
schema and rows do not carry into the next context. Use a temporary file when a
test needs multiple contexts to observe the same SQLite database.

Typed configuration also supports read-only access, foreign-key enforcement,
busy timeout, and journal mode.

For a short-lived script, migration context, or isolated test, direct context
configuration is also available. That context owns and closes its connection:

```ts
import { DbContext, type DbContextOptionsBuilder } from "@entitykit/core";

class ScriptDbContext extends DbContext {
  protected override configure(options: DbContextOptionsBuilder): void {
    options.useSqlite("./app.db");
  }
}
```

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
