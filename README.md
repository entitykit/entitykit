# EntityKit

EntityKit is an Entity Framework-inspired ORM for TypeScript. It combines
ordinary class entities, fluent mapping, `DbContext`, typed queries, change
tracking, migrations, and transactional writes across SQLite, Postgres, and
MySQL.

The `0.1.0-alpha` line is a public preview. APIs may still change before 1.0.
Use short-lived contexts and test upgrades against your own schema and queries.

## Install

```bash
npm install entitykit@alpha
```

Install `pg` or `mysql2` when using those providers. SQLite uses Node's
built-in `node:sqlite` module. EntityKit requires Node 22.13 or newer.

| Provider | Import | Driver |
| --- | --- | --- |
| SQLite | `entitykit/sqlite` | built into Node |
| Postgres | `entitykit/postgres` | `pg` |
| MySQL | `entitykit/mysql` | `mysql2` |

Importing `entitykit` does not load an optional database driver.

## Quick start

```ts
import {
  DbContext,
  type DbContextOptionsBuilder,
  type ModelBuilder
} from "entitykit";

class User {
  id = "";
  email = "";
  name = "";
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
      entity.property(user => user.name).hasColumnType("text").isRequired();
      entity.hasIndex(user => user.email).isUnique();
    });
  }
}

await using db = AppDbContext.create();
await db.database.ensureCreated();

const user = Object.assign(new User(), {
  id: "usr_1",
  email: "ada@example.com",
  name: "Ada"
});
db.users.add(user);
await db.saveChanges();

const loaded = await db.users
  .where(candidate => candidate.email.eq("ada@example.com"))
  .single();

loaded.name = "Ada Lovelace";
await db.saveChanges();
```

## Core behavior

- Entities are ordinary TypeScript classes; decorators and generated clients
  are not required.
- Queries use typed expressions rather than parsing JavaScript source.
- Tracked queries use an identity map and snapshot change tracking.
- `saveChanges()` uses a transaction or nested savepoint.
- Includes and relationship loading are explicit.
- Optimistic concurrency conflicts expose immutable database values and
  support `clientWins` and `databaseWins` recovery.
- Audit fields, tenant scopes, soft deletes, generated values, complex value
  objects, set-based writes, and transactional outbox rows are supported.
- SQL parameters remain separate from SQL text.

## Package entrypoints

- `entitykit` — contexts, mapping, queries, tracking, and common errors
- `entitykit/sqlite`, `entitykit/postgres`, `entitykit/mysql` — providers
- `entitykit/cli` — CLI configuration and programmatic execution
- `entitykit/migrations` — migration authoring and execution
- `entitykit/adapter` — custom-provider contracts
- `entitykit/tooling` — schema introspection and code generation
- `entitykit/testing` — provider-neutral test doubles
- `entitykit/experimental` — unstable compiler and tooling internals

## Migrations

```bash
npx entitykit init
npx entitykit migration add InitialCreate
npx entitykit db migrate --dry-run
npx entitykit db migrate
```

## Deliberate boundaries

EntityKit does not use decorators, hidden lazy loading, generated clients, or
function-source parsing. The experimental subpath does not carry compatibility
guarantees during the alpha.

## License

MIT
