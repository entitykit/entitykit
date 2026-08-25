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
loads `pg` unless a context selects Postgres.

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

Typed configuration supports host/database credentials, TLS, pool sizing,
connection and statement timeouts, lock timeouts, and uncommon `pg` options.

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
