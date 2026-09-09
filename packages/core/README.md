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

> [!IMPORTANT]
> This README describes `0.1.0-alpha.2`. With the previous `0.1.0-alpha.1`,
> select the shared source explicitly with `options.useDataSource(source)` in
> `configure()`.

## Start

```ts
import {
  DbContext,
  type ModelBuilder,
} from "@entitykit/core";
import { createSqliteDataSource } from "@entitykit/sqlite";

type NewUser = { id: string; email: string };

class User {
  id: string;
  email: string;

  constructor(input: NewUser) {
    this.id = input.id;
    this.email = input.email;
  }
}

class AppDbContext extends DbContext {
  readonly users = this.set(User);

  protected override model(model: ModelBuilder): void {
    model.entity(User, entity => {
      entity.toTable("users");
      entity.hasKey(user => user.id);
      entity.property(user => user.id).hasColumnType("text").isRequired();
      entity.property(user => user.email).hasColumnType("text").isRequired();
      entity.materialize(values => {
        const { id, email } = values;
        if (typeof id !== "string" ||
            typeof email !== "string") {
          throw new Error("Cannot materialize User: required fields are missing or invalid.");
        }
        return new User({ id, email });
      });
    });
  }
}

const dataSource = createSqliteDataSource("./app.db");

try {
  await using db = dataSource.createContext(AppDbContext);

  await db.database.ensureCreated();
  const ada = db.users.create({ id: "usr_1", email: "ada@example.com" });
  await db.saveChanges();

  const users = await db.users
    .where(user => user.email.endsWith("@example.com"))
    .toArray();
} finally {
  await dataSource.dispose();
}
```

`users.create()` constructs and tracks a new entity without executing SQL. Its
input comes from the `User` constructor; `saveChanges()` writes the row. The
separate `materialize()` factory reconstructs stored rows when querying.

In an application, keep the data source for the application lifetime and make
the context inside each request, job, or unit of work. Dispose the context
first, then dispose the source during shutdown. The optional `DbContext`
constructor selects a supplied data source automatically; an override of
`configure()` receives options with that source already selected. Add context
options directly; calling `super.configure(options)` is optional. Selecting a
second provider, source, or connection is an error.

## Includes

- Plain class entities and explicit fluent mapping
- Typed filters, ordering, paging, projections, joins, and aggregates
- Tracked and untracked materialization
- Transactional writes, savepoints, bulk operations, and concurrency recovery
- Explicit relationship loading and opt-in awaitable lazy loading
- Tenant scopes, soft deletes, audit fields, outbox rows, and diagnostics
- Migration, schema-generation, and provider-extension contracts
- Application-scoped data sources with bounded retry coordination

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
