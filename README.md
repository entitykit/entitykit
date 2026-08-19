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

`init` writes provider configuration and an empty `AppDbContext`. Add your
entities and model mappings to `src/db/app-db-context.ts` before the first
migration; without them the model is empty and nothing is detected to migrate.

```bash
npx entitykit init
# add entities and model mappings to src/db/app-db-context.ts
npx entitykit migration add InitialCreate
npx entitykit db migrate --dry-run
npx entitykit db migrate
```

## Known alpha limitations

These are current gaps rather than settled design. Each one surfaces as an
explicit error, a warning, or a generated comment instead of silent behavior.

| Area | Limitation |
| --- | --- |
| Provider parity | Sequences, covering indexes, `create index concurrently`, extensions, and `migration script --idempotent` are Postgres-only. Partial indexes are unavailable on MySQL. SQLite takes no migration advisory lock and supports only `serializable` and `readUncommitted` isolation. |
| SQLite migrations | SQLite cannot alter a column in place, add or drop table constraints, or rename an index. Those changes go through a table rebuild that recreates modeled columns, constraints, and indexes only; preserve custom triggers by hand. |
| MySQL migrations | MySQL DDL commits implicitly, so a migration that fails partway does not roll back. |
| Renames | The model differ does not detect renames. Without `--rename-table` or `--rename-column` a rename is generated as a drop plus an add. |
| Generated SQL | Migrations are scaffolded from a model diff and expect human review. Destructive operations are reported as warnings and require `--allow-data-loss`; `db migrate --dry-run` prints the exact plan first. |
| `db pull` | Schema EntityKit cannot model — expression and partial indexes, index prefix lengths, descending key order, foreign keys outside the pulled snapshot — is skipped, marked `// TODO` in the generated file, and listed under `Review required:`. |
| `entitykit/experimental` | Compiler and builder internals with no compatibility guarantees during the alpha. |

## Deliberate boundaries

EntityKit does not use decorators, hidden lazy loading, generated clients, or
function-source parsing. The experimental subpath does not carry compatibility
guarantees during the alpha.

## License

MIT
