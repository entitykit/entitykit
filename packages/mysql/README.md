<p align="center">
  <img src="https://raw.githubusercontent.com/entitykit/entitykit/main/entitykit-logo.svg" alt="EntityKit" width="560">
</p>

<h1 align="center">@entitykit/mysql</h1>

<p align="center"><strong>MySQL for EntityKit, using mysql2.</strong></p>

<p align="center">
  <a href="https://github.com/entitykit/entitykit/blob/main/USAGE.md">Usage</a>
  <span> · </span>
  <a href="https://github.com/entitykit/entitykit/blob/main/API.md">API</a>
  <span> · </span>
  <a href="https://github.com/entitykit/entitykit/blob/main/docs/compatibility.md">Compatibility</a>
</p>

The provider supplies pooled connections, schema introspection, MySQL SQL and
migration dialects, and driver value normalization. Core never loads `mysql2`
until a data source or context selects MySQL.

## Install

```sh
npm install @entitykit/core@alpha @entitykit/mysql@alpha mysql2
```

> [!IMPORTANT]
> This README describes `0.1.0-alpha.2`. With the previous `0.1.0-alpha.1`,
> select the shared source explicitly with `options.useDataSource(source)` in
> `configure()`.

## Application data source

```ts
import { DbContext } from "@entitykit/core";
import { createMySqlDataSource } from "@entitykit/mysql";

class AppDbContext extends DbContext {}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const dataSource = createMySqlDataSource(databaseUrl);

const db = dataSource.createContext(AppDbContext);
try {
  // Await one request, job, or other unit of work through db.
} finally {
  await db.dispose();
}

// Application shutdown, after every context has been disposed:
await dataSource.dispose();
```

Create one source and `mysql2` pool for the application. Create and dispose a
fresh context for every request, job, or unit of work, then dispose the source
during application shutdown. `DbContext` accepts the source through its
optional constructor, so a source-backed context does not need provider
configuration.

Typed configuration supports host/database credentials, TLS, charset and
timezone, pool sizing, connection and command timeouts, and uncommon `mysql2`
options.

Direct context configuration remains convenient for a short-lived script,
migration context, or isolated test:

```ts
import { DbContext, type DbContextOptionsBuilder } from "@entitykit/core";

class ScriptDbContext extends DbContext {
  protected override configure(options: DbContextOptionsBuilder): void {
    options.useMySql(databaseUrl);
  }
}
```

That context owns the connection source it creates. Do not call `useMySql()`
in a new request context: doing so creates a new pool per request. Server
applications should share `createMySqlDataSource()`.

## Direct provider API

The package exports `mySqlProviderServices`, `createMySqlDataSource`,
`MySqlDatabaseConnection`, `MySqlSchemaIntrospector`, MySQL runtime and migration
dialects, the MySQL value reader, and a standalone parameterized `rawSql` tag.

```ts
import { mySqlProviderServices } from "@entitykit/mysql";

options.useProvider(mySqlProviderServices, {
  connectionString: process.env.DATABASE_URL,
});
```

## Boundaries

MySQL DDL commits implicitly, so a migration that fails partway cannot be
rolled back as one transaction. Partial indexes, sequences, extensions,
concurrent indexes, and idempotent migration scripts are unavailable. Review
`ensureCreated()` and `createScript()` as one-time bootstrap plans: normal index
DDL has no existence guard and may fail when replayed. See
the complete [provider boundary](https://github.com/entitykit/entitykit/blob/main/docs/compatibility.md#mysql).

## License

MIT
