<p align="center">
  <img src="https://raw.githubusercontent.com/entitykit/entitykit/main/entitykit-logo.svg" alt="EntityKit" width="560">
</p>

<h1 align="center">@entitykit/core</h1>

<p align="center"><strong>The provider-neutral EntityKit runtime.</strong></p>

<p align="center">
  <a href="https://github.com/entitykit/entitykit/blob/main/USAGE.md">Usage</a>
  <span> · </span>
  <a href="https://github.com/entitykit/entitykit/blob/main/API.md">API</a>
  <span> · </span>
  <a href="https://github.com/entitykit/entitykit/blob/main/docs/compatibility.md">Compatibility</a>
</p>

Use ordinary TypeScript classes with `DbContext`, fluent model mapping, typed
queries, identity-map tracking, and transactional `saveChanges()`. Core carries
no database driver.

## Install

Install core with one provider:

```sh
npm install @entitykit/core@alpha @entitykit/sqlite@alpha
```

Choose `@entitykit/postgres` or `@entitykit/mysql` instead when appropriate.

## Start

```ts
import {
  DbContext,
  type DbContextOptionsBuilder,
  type ModelBuilder,
} from "@entitykit/core";

class User {
  id = "";
  email = "";
}

class AppDbContext extends DbContext {
  readonly users = this.set(User);

  protected override configure(options: DbContextOptionsBuilder): void {
    options.useSqlite("./app.db");
  }

  protected override model(model: ModelBuilder): void {
    model.entity(User, entity => {
      entity.toTable("users");
      entity.hasKey(user => user.id);
      entity.property(user => user.id).hasColumnType("text").isRequired();
      entity.property(user => user.email).hasColumnType("text").isRequired();
    });
  }
}

await using db = AppDbContext.create();

const users = await db.users
  .where(user => user.email.endsWith("@example.com"))
  .toArray();
```

## Includes

- Plain class entities and explicit fluent mapping
- Typed filters, ordering, paging, projections, joins, and aggregates
- Tracked and untracked materialization
- Transactional writes, savepoints, bulk operations, and concurrency recovery
- Explicit relationship loading and opt-in awaitable lazy loading
- Tenant scopes, soft deletes, audit fields, outbox rows, and diagnostics
- Migration, schema-generation, and provider-extension contracts

## Entry points

| Import | Purpose |
| --- | --- |
| `@entitykit/core` | Application runtime and public types |
| `@entitykit/core/migrations` | Migration authoring, diffing, and execution |
| `@entitykit/core/tooling` | Schema snapshots, code generation, and safe file writes |
| `@entitykit/core/adapter` | Custom provider and data-source contracts |
| `@entitykit/core/experimental` | Unstable compiler and builder internals |

The experimental entry point has no compatibility guarantee during alpha.

## Requirements

EntityKit requires Node 22.13 or newer. Provider packages are versioned in
lockstep with core and peer on the exact same alpha version, preventing an
application from loading two incompatible core runtimes.

Read the [usage guide](https://github.com/entitykit/entitykit/blob/main/USAGE.md)
for a complete context and the
[API reference](https://github.com/entitykit/entitykit/blob/main/API.md) for
public operations and types.

## License

MIT
