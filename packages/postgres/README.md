<p align="center">
  <img src="https://raw.githubusercontent.com/entitykit/entitykit/main/entitykit-logo.svg" alt="EntityKit" width="560">
</p>

<h1 align="center">@entitykit/postgres</h1>

<p align="center"><strong>Postgres for EntityKit, using pg.</strong></p>

<p align="center">
  <a href="https://github.com/entitykit/entitykit/blob/main/USAGE.md">Usage</a>
  <span> · </span>
  <a href="https://github.com/entitykit/entitykit/blob/main/API.md">API</a>
  <span> · </span>
  <a href="https://github.com/entitykit/entitykit/blob/main/docs/compatibility.md">Compatibility</a>
</p>

The provider supplies pooled connections, schema introspection, Postgres SQL
and migration dialects, and provider-specific statement helpers. Core never
loads `pg` until a data source or context selects Postgres.

## Install

```sh
npm install @entitykit/core@alpha @entitykit/postgres@alpha pg
```

> [!IMPORTANT]
> This README describes `0.1.0-alpha.2`. With the previous `0.1.0-alpha.1`,
> select the shared source explicitly with `options.useDataSource(source)` in
> `configure()`.

## Application data source

```ts
import { DbContext } from "@entitykit/core";
import { createPostgresDataSource } from "@entitykit/postgres";

class AppDbContext extends DbContext {}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const dataSource = createPostgresDataSource(databaseUrl);

const db = dataSource.createContext(AppDbContext);
try {
  // Await one request, job, or other unit of work through db.
} finally {
  await db.dispose();
}

// Application shutdown, after every context has been disposed:
await dataSource.dispose();
```

Create one source and `pg` pool for the application. Create and dispose a fresh
context for every request, job, or unit of work, then dispose the source during
application shutdown. `DbContext` accepts the source through its optional
constructor, so a source-backed context does not need provider configuration.

Typed configuration supports host/database credentials, TLS, pool sizing,
connection and statement timeouts, lock timeouts, and uncommon `pg` options.

Direct context configuration remains convenient for a short-lived script,
migration context, or isolated test:

```ts
import { DbContext, type DbContextOptionsBuilder } from "@entitykit/core";

class ScriptDbContext extends DbContext {
  protected override configure(options: DbContextOptionsBuilder): void {
    options.usePostgres(databaseUrl);
  }
}
```

That context owns the connection source it creates. Do not call
`usePostgres()` in a new request context: doing so creates a new pool per
request. Server applications should share `createPostgresDataSource()`.

## Direct provider API

The package exports `postgresProviderServices`, `createPostgresDataSource`,
`PostgresDatabaseConnection`, `PostgresSchemaIntrospector`, Postgres runtime and
migration dialects, and a standalone parameterized `rawSql` tag.

```ts
import { postgresProviderServices } from "@entitykit/postgres";

options.useProvider(postgresProviderServices, {
  connectionString: process.env.DATABASE_URL,
});
```

The `postgres` helper object builds provider-specific mapped upsert, update,
delete, and date-bucket expressions when a neutral operation cannot express the
required SQL.

## Migrations

Postgres supports the broadest migration surface: advisory locking,
transaction-suppressed operations, sequences, extensions, covering and partial
indexes, concurrent index creation, and idempotent scripts. Generated migrations
still require review before deployment.

See [compatibility](https://github.com/entitykit/entitykit/blob/main/docs/compatibility.md#postgres)
for the exact provider contract.

## License

MIT
