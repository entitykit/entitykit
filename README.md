<p align="center">
  <img src="./entitykit-logo.svg" alt="EntityKit" width="720">
</p>

<p align="center"><strong>An Entity Framework-inspired ORM for TypeScript.</strong></p>

<p align="center">
  Model ordinary classes, write typed queries, track changes, and evolve schemas
  across SQLite, Postgres, and MySQL.
</p>

<p align="center">
  <a href="https://github.com/entitykit/entitykit/actions/workflows/ci.yml"><img src="https://github.com/entitykit/entitykit/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
</p>

<p align="center">
  <a href="#install">Install</a>
  <span> · </span>
  <a href="#quick-start">Quick start</a>
  <span> · </span>
  <a href="./docs/README.md">Docs</a>
  <span> · </span>
  <a href="#model">Model</a>
  <span> · </span>
  <a href="#packages">Packages</a>
  <span> · </span>
  <a href="#migrations">Migrations</a>
  <span> · </span>
  <a href="#learn">Learn</a>
  <span> · </span>
  <a href="#alpha">Alpha</a>
</p>

<br />

> [!IMPORTANT]
> EntityKit is prerelease software; APIs may change before 1.0. This branch is
> the coordinated `0.1.0-alpha.2` family. The previous `alpha.1` release lacks
> both `@entitykit/nestjs` and the source-backed `DbContext` constructor shown
> below; if `@alpha` still resolves there, select a shared source explicitly
> with `options.useDataSource(source)` in `configure()`.

With a configured context, application code looks like this:

```ts
const user = db.users.create({
  id: "usr_1",
  email: "ada@example.com",
  name: "Ada",
});

await db.saveChanges();

const users = await db.users
  .where(user => user.email.endsWith("@example.com"))
  .orderBy(user => user.name)
  .toArray();
```

The quick start below includes the complete model and context setup.

## Install

Install the provider-neutral runtime, one database provider, and the CLI:

```sh
npm install @entitykit/core@alpha @entitykit/sqlite@alpha
npm install -D @entitykit/cli@alpha
```

| Database | Provider | Driver |
| --- | --- | --- |
| SQLite | `@entitykit/sqlite` | Built into Node |
| Postgres | `@entitykit/postgres` | `pg` |
| MySQL | `@entitykit/mysql` | `mysql2` |

```sh
# Postgres
npm install @entitykit/core@alpha @entitykit/postgres@alpha pg

# MySQL
npm install @entitykit/core@alpha @entitykit/mysql@alpha mysql2
```

EntityKit requires Node 22.13 or newer. Importing `@entitykit/core` does not
load a provider or database driver.

## Quick start

Define an ordinary class and map it in a `DbContext`:

```ts
import {
  DbContext,
  type ModelBuilder,
} from "@entitykit/core";
import { createSqliteDataSource } from "@entitykit/sqlite";

type NewUser = { id: string; email: string; name: string };

class User {
  id: string;
  email: string;
  name: string;

  constructor(input: NewUser) {
    this.id = input.id;
    this.email = input.email;
    this.name = input.name;
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
      entity.property(user => user.name).hasColumnType("text").isRequired();
      entity.materialize(values => {
        const { id, email, name } = values;
        if (typeof id !== "string" ||
            typeof email !== "string" ||
            typeof name !== "string") {
          throw new Error("Cannot materialize User: required fields are missing or invalid.");
        }
        return new User({ id, email, name });
      });
      entity.hasIndex(user => user.email).isUnique();
    });
  }
}

const dataSource = createSqliteDataSource("./app.db");
```

Create a local schema, write a row, query it, and save a tracked change.
`users.create()` constructs and tracks the entity; it executes no SQL.
`saveChanges()` persists the pending work:

```ts
try {
  await using db = dataSource.createContext(AppDbContext);

  await db.database.ensureCreated();

  const user = db.users.create({
    id: "usr_1",
    email: "ada@example.com",
    name: "Ada",
  });

  await db.saveChanges();

  const loaded = await db.users
    .where(candidate => candidate.email.eq("ada@example.com"))
    .single();

  loaded.name = "Ada Lovelace";
  await db.saveChanges();
} finally {
  await dataSource.dispose();
}
```

The lifecycle is deliberate: create one provider data source for the
application, create a fresh context for every request, job, or other unit of
work, dispose that context, then dispose the data source during application
shutdown. `DbContext` accepts the source in its optional constructor, so a
source-backed context needs no provider-specific `configure()` method.

`ensureCreated()` is convenient for a one-time prototype or disposable-database
bootstrap; it is not a deployment or schema-evolution primitive. Once a schema
must evolve without losing data, use source-controlled migrations.

## Model

<table>
  <tr>
    <td width="50%" valign="top">
      <strong>Domain model</strong><br>
      Plain TypeScript classes, explicit fluent mapping, value converters,
      complex properties, keys, indexes, and relationships.
    </td>
    <td width="50%" valign="top">
      <strong>Typed queries</strong><br>
      Filters, ordering, paging, projections, joins, aggregates, relationship
      predicates, streaming, and parameterized SQL.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>Unit of work</strong><br>
      Identity-map materialization, snapshot change tracking, transactional
      <code>saveChanges()</code>, savepoints, and optimistic concurrency.
    </td>
    <td width="50%" valign="top">
      <strong>Explicit relationships</strong><br>
      Split-query includes, filtered collections, explicit loading, and opt-in
      awaitable lazy loading—never hidden property-access I/O.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>Schema workflow</strong><br>
      Model snapshots, generated migrations, dry runs, SQL scripts, guarded
      destructive changes, and database-first model generation.
    </td>
    <td width="50%" valign="top">
      <strong>Application controls</strong><br>
      Tenant scopes, soft deletes, audit fields, outbox rows, cancellation,
      diagnostics, retries, and provider-neutral test doubles.
    </td>
  </tr>
</table>

EntityKit does not require decorators, generated clients, function-source
parsing, or hidden lazy loading. Query selectors build typed expression trees;
values stay separate from generated SQL.

## Packages

| Package | Role |
| --- | --- |
| [`@entitykit/core`](./packages/core/) | Contexts, mapping, queries, tracking, errors, and configuration |
| [`@entitykit/sqlite`](./packages/sqlite/) | SQLite provider using Node's built-in `node:sqlite` |
| [`@entitykit/postgres`](./packages/postgres/) | Postgres provider using `pg` |
| [`@entitykit/mysql`](./packages/mysql/) | MySQL provider using `mysql2` |
| [`@entitykit/cli`](./packages/cli/) | Migrations, database inspection, and scaffolding |
| [`@entitykit/testing`](./packages/testing/) | Provider-neutral recording test doubles |
| [`@entitykit/nestjs`](./packages/nestjs/) | Native-ESM NestJS 12 lifecycle integration; begins in `alpha.2` |

Core also exposes focused `/migrations`, `/tooling`, and `/adapter` entry
points. `/experimental` contains unstable compiler and builder internals.

## Migrations

The CLI creates configuration and context files, compares the current model
with its checked-in snapshot, and produces reviewable TypeScript migrations:

```sh
npx entitykit init
# add entities and mappings to src/db/app-db-context.ts
npx entitykit migration add InitialCreate
npx entitykit db migrate --dry-run
npx entitykit db migrate
```

Rename hints preserve data when a model name changes. Destructive forward
operations are reported and require explicit `--allow-data-loss` approval.
Generated migrations are source code: review them before applying them.

The [migration guide](./docs/migrations.md) covers renames, rollback planning,
deployment scripts, database-first projects, and provider-specific DDL rules.

## Learn

- [Documentation map](./docs/README.md) — the shortest path for newcomers,
  framework users, contributors, and release maintainers.
- [Usage guide](./USAGE.md) — build a real context, query, save, load
  relationships, run transactions, and manage migrations.
- [API reference](./API.md) — packages, entry points, public operations, errors,
  and extension surfaces.
- [Framework guide](./docs/frameworks.md) — NestJS 12 and the Node-runtime
  Next.js 16 integration pattern.
- [Next.js + Postgres demo](./examples/nextjs-postgres/) — a production-shaped
  App Router example pinned to the exact `alpha.2` workspace family.
- [Compatibility](./docs/compatibility.md) — Node support, provider parity, and
  current alpha boundaries.
- [Architecture](./docs/architecture.md) — package ownership, provider seams,
  and the query/save pipelines.

## Alpha

EntityKit is deliberately honest about its current boundary. The
`0.1.0-alpha.1` release was the original six-package family; the coordinated
`0.1.0-alpha.2` source adds the NestJS package and the refined data-source
lifecycle API.

- Every package in a coordinated release moves on one exact prerelease version.
- The public API may change before 1.0; `/experimental` has no compatibility
  promise during alpha.
- Provider-neutral behavior is shared, but database DDL, isolation, locking,
  collation, and schema-introspection details still differ.
- Migration generation is conservative. Renames and destructive changes need
  explicit review.
- SQLite table rebuilds and MySQL's implicitly committed DDL require extra care.

The complete, provider-by-provider contract lives in
[Compatibility](./docs/compatibility.md).

## Development

```sh
npm ci
npm run verify
```

Read [Contributing](./CONTRIBUTING.md) before changing package boundaries or a
public API. Report suspected vulnerabilities through the private process in
[Security](./SECURITY.md). Maintainers should follow the exact
[release runbook](./docs/releasing.md) for the published alpha family.

## License

MIT. See [LICENSE](./LICENSE).
