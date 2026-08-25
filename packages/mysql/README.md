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
unless a context selects MySQL.

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

Typed configuration supports host/database credentials, TLS, charset and
timezone, pool sizing, connection and command timeouts, and uncommon `mysql2`
options.

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
