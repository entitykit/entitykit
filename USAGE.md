# Usage

EntityKit maps ordinary TypeScript classes to a database through a short-lived
`DbContext`. This guide follows the common path from the first model to a
production migration. The [API reference](./API.md) lists the complete public
surface; the [README](./README.md) covers packages, alpha limits, and provider
differences.

## Install

Install core, one provider, and the command-line tool. Postgres and MySQL also
need their database driver.

| Database | Runtime | Driver |
| --- | --- | --- |
| SQLite | `npm install @entitykit/core@alpha @entitykit/sqlite@alpha` | built into Node |
| Postgres | `npm install @entitykit/core@alpha @entitykit/postgres@alpha pg` | `pg` |
| MySQL | `npm install @entitykit/core@alpha @entitykit/mysql@alpha mysql2` | `mysql2` |

```sh
npm install -D @entitykit/cli@alpha
```

EntityKit requires Node 22.13 or newer. `@entitykit/core` does not load a
provider or driver until a context selects one.

## Define a context

Entities are classes. Mapping stays in the context, so domain objects do not
need decorators or generated base types.

```ts
import {
  DbContext,
  DeleteBehavior,
  type DbContextOptionsBuilder,
  type ModelBuilder,
} from "@entitykit/core";

class User {
  id = "";
  email = "";
  name = "";
  posts: Post[] = [];
}

class Post {
  id = "";
  authorId = "";
  title = "";
  status = "draft";
  author: User | null = null;
}

export class AppDbContext extends DbContext {
  readonly users = this.set<User, [string]>(User);
  readonly posts = this.set<Post, [string]>(Post);

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

    model.entity(Post, entity => {
      entity.toTable("posts");
      entity.hasKey(post => post.id);
      entity.property(post => post.id).hasColumnType("text").isRequired();
      entity.property(post => post.authorId)
        .hasColumnName("author_id")
        .hasColumnType("text")
        .isRequired();
      entity.property(post => post.title).hasColumnType("text").isRequired();
      entity.property(post => post.status).hasColumnType("text").isRequired();
      entity.hasOne(User, post => post.author)
        .withMany(user => user.posts)
        .hasForeignKey(post => post.authorId)
        .onDelete(DeleteBehavior.Cascade);
    });
  }
}
```

For another database, install its package and change the provider call:

```ts
options.usePostgres(process.env.DATABASE_URL ?? "");
options.useMySql(process.env.DATABASE_URL ?? "");
```

Configure exactly one provider per context. In production, validate required
environment variables instead of accepting an empty connection string.

## Create a database

`ensureCreated()` executes the provider's complete creation plan. Use it to
bootstrap a new test, local-tool, or disposable database—not to evolve or
repeatedly reconcile an existing schema.

```ts
await using db = AppDbContext.create();
await db.database.ensureCreated();
```

It does not compare or alter an existing schema. MySQL creation plans may
contain unguarded index statements, so neither `ensureCreated()` nor a rendered
creation script is universally safe to rerun. Use migrations for any database
whose history matters. `createScript()` is available when a test or tool needs
to inspect the complete provider SQL without running it.

## Query entities

Queries are immutable and execute only at a terminal operation such as
`toArray()`, `firstOrNull()`, `single()`, `count()`, or `exists()`.

```ts
await using db = AppDbContext.create();

const page = await db.users
  .where(user => user.email.endsWith("@example.com"))
  .orderBy(user => user.name)
  .skip(20)
  .take(20)
  .asNoTracking()
  .toArray();
```

Fields expose typed operators including `eq`, `ne`, `in`, comparisons, null
checks, and string matching. Combine predicates with `and()`, `or()`, and
`not()`.

`find(key)` checks the context identity map before querying. Use
`findOrThrow(key)` when absence is exceptional.

```ts
const user = await db.users.find("usr_1");
const requiredUser = await db.users.findOrThrow("usr_1");
```

Use `asNoTracking()` for read-only entity queries. A context tracks entity
queries by default so later property changes can be saved.

## Project read models

`select()` returns only the fields a screen or service needs. Projections are
typed and untracked.

```ts
const cards = await db.users
  .where(user => user.email.endsWith("@example.com"))
  .select((user, project) => ({
    id: user.id,
    displayName: project.upper(user.name),
  }))
  .toArray();
```

Grouping and aggregates use the same query pipeline:

```ts
const totals = await db.posts
  .groupBy(post => ({ status: post.status }))
  .select(group => ({
    status: group.key.status,
    posts: group.count(),
  }))
  .toArray();
```

## Load relationships

Relationships load only when requested. Use `include()` with a query when the
related data belongs in the result.

```ts
const user = await db.users
  .where(candidate => candidate.id.eq("usr_1"))
  .include(candidate => candidate.posts
    .orderByDescending(post => post.id)
    .take(10))
  .single();
```

Use `thenInclude()` for a deeper path. Collection includes can also use
`where()`, `orderBy()`, `skip()`, and `take()`.

For a relationship needed later, load it through the tracked entry:

```ts
const entry = db.entry(user);
await entry?.collection(candidate => candidate.posts).load();
```

Plain property access never performs hidden I/O.

## Track and save changes

Add an entity, change a tracked entity, or mark one for removal, then call
`saveChanges()`.

```ts
const created = Object.assign(new User(), {
  id: "usr_2",
  email: "grace@example.com",
  name: "Grace",
});

db.users.add(created);
await db.saveChanges();

const loaded = await db.users.findOrThrow("usr_2");
loaded.name = "Grace Hopper";

console.log(db.getSavePlanDebugView());
const affected = await db.saveChanges();
```

`add()`, `attach()`, and `remove()` return an `EntityEntry`. The entry exposes
original values, changed properties, database values, reload, and explicit
relationship loaders. `changeTracker.debugView()` shows the complete tracked
state without writing it.

Keep a context short-lived and scoped to one unit of work. Do not start
overlapping queries or saves on the same context.

## Write without loading

Use set-based writes when every matching row should change in one statement.

```ts
const published = await db.posts
  .where(post => post.status.eq("draft"))
  .executeUpdate({ status: "published" });

const deleted = await db.posts
  .where(post => post.status.eq("archived"))
  .executeDelete();
```

Both operations require an explicit `where()` and reject result-shaping clauses
such as `orderBy()`, `skip()`, and `take()`. They do not refresh entities the
context already tracks; clear or reload those entries before using them again.

Use `upsert()` for an insert-or-update batch. The portable shape targets the
primary key on a model without secondary unique keys:

```ts
await db.posts.upsert(
  [Object.assign(new Post(), {
    id: "post_2",
    authorId: "usr_1",
    title: "A typed unit of work",
    status: "published",
  })],
  {
    updateProperties: ["title", "status"],
  },
);
```

Postgres and SQLite can target a selected mapped unique key through
`conflictProperties`. MySQL's clause fires on any primary or unique conflict,
so EntityKit rejects non-primary targets and models with secondary unique keys
rather than risk updating the wrong row.

## Use transactions

`saveChanges()` is transactional. Use `transaction()` when several saves or
raw commands must commit together.

```ts
await db.transaction(async transaction => {
  transaction.posts.add(Object.assign(new Post(), {
    id: "post_1",
    authorId: "usr_1",
    title: "Hello, EntityKit",
    status: "published",
  }));

  await transaction.saveChanges();
  await transaction.database.execute`
    update users set name = ${"Ada Lovelace"} where id = ${"usr_1"}
  `;
}, { isolationLevel: "serializable" });
```

Nested transactions use savepoints when the provider supports them. If a
driver reports an unknown commit outcome, reconcile the operation before
retrying it blindly.

## Use raw SQL

Tagged templates keep values separate from SQL text.

```ts
const rows = await db.database.sql<{
  status: string;
  total: number | string;
}>`
  select status, count(*) as total
  from posts
  where author_id = ${"usr_1"}
  group by status
`;

const affectedRows = await db.database.execute`
  update posts set status = ${"archived"} where id = ${"post_1"}
`;
```

Use `fromSqlUnsafe` when caller-owned SQL should materialize a mapped entity:

```ts
const posts = await db.posts.fromSqlUnsafe`
  select id, author_id, title, status
  from posts
  where author_id = ${"usr_1"}
`.toArray();
```

The name is deliberate: this path bypasses EntityKit query filters, tenant
scope, and query composition. It is untracked by default. Call `asTracking()`
only after selecting the complete mapped shape. Interpolated values are still
parameters; never build SQL by concatenating user input.

`database.rawSql` builds a reusable statement for `executeStatement()`. Each
provider package also exports a standalone `rawSql` tag with its own placeholder
style.

## Configure migrations

The CLI reads `entitykit.config.ts`. The provider service comes from the
installed provider package, while the config helper comes from core.

```ts
import { defineEntityKitConfig } from "@entitykit/core";
import { sqliteProviderServices } from "@entitykit/sqlite";
import { AppDbContext } from "./src/db/app-db-context";

export default defineEntityKitConfig({
  context: AppDbContext,
  provider: sqliteProviderServices,
  connection: "./app.db",
  migrationsDir: "src/db/migrations",
});
```

`entitykit init --provider sqlite` can create this shape. Add the entities and
mappings to the generated context before creating the first migration.

```sh
npx entitykit migration add InitialCreate
npx entitykit migration check
npx entitykit db migrate --dry-run
npx entitykit migration script --from 0 --to latest -o deploy.sql
npx entitykit db migrate
npx entitykit db status --check
```

Review every generated migration. Rename detection is explicit through
`--rename-table old=new` and `--rename-column table.old=new`. Destructive
forward operations need a reviewed `--allow-data-loss` when they are applied;
rollback plans require the same scrutiny without that gate.

For an existing database, use `npx entitykit db pull`. Generated code marks
schema details that need manual review rather than silently pretending they
were modeled.

## Add diagnostics

Runtime diagnostics cover queries, query plans, includes, saves, transactions,
lazy loads, and migrations.

```ts
protected override configure(options: DbContextOptionsBuilder): void {
  options
    .useSqlite("./app.db")
    .useDiagnostics(event => {
      console.info(event.kind, event.provider, event.durationMs);
    });
}
```

Values and original errors are redacted by default. Keep them redacted in
production; `{ includeSensitiveData: true }` is an explicit local-debugging
choice. Diagnostic handlers observe work but do not control its result.

For a single query, `toDebugSql()` renders SQL with values redacted and their
types retained, while `toPlan()` returns a serializable query plan without
executing it.

## Test without a database

`@entitykit/testing` provides a recording connection for application tests that
need to inspect SQL, parameters, transaction boundaries, or failure handling
without starting a database.

```sh
npm install -D @entitykit/testing@alpha
```

```ts
import { RecordingDatabaseConnection } from "@entitykit/testing";

const connection = new RecordingDatabaseConnection();

class TestDbContext extends AppDbContext {
  protected override configure(options: DbContextOptionsBuilder): void {
    options.useConnection(connection);
  }
}

connection.queueResult({ rows: [{ id: "usr_1" }], rowCount: 1 });

await using db = TestDbContext.create();
await db.database.sql`select id from users`;

expect(connection.statements).toEqual([
  { text: "select id from users", values: [] },
]);
```

The recording connection proves provider-neutral orchestration, not database
semantics. Keep live SQLite, Postgres, or MySQL coverage for behavior owned by
the database or driver.

## Handle errors

EntityKit errors expose stable `code`, `details`, and `toJSON()` fields. Use the
class when recovery is specific and `isEntityKitError()` at process boundaries.

```ts
import {
  DbUpdateConcurrencyError,
  isEntityKitError,
} from "@entitykit/core";

try {
  await db.saveChanges();
} catch (error) {
  if (error instanceof DbUpdateConcurrencyError) {
    await error.entry?.resolveConcurrency("databaseWins");
    return;
  }

  if (isEntityKitError(error)) {
    console.error(error.code, error.toJSON());
  }
  throw error;
}
```

Choose `databaseWins` to discard the conflicting tracked change. Choose
`clientWins` only when the application can retry the save deliberately. Unique,
foreign-key, not-null, cancellation, provider capability, and migration
failures also have typed error codes.

## Production checklist

- Install only the provider packages and drivers the application uses; configure
  exactly one provider per context.
- Validate connection configuration before creating the context.
- Use one short-lived context per request, job, or unit of work.
- Do not run concurrent operations through the same context.
- Use migrations, review their SQL, and run `db migrate --dry-run` before
  applying them.
- Run `migration check` in development and `db status --check` in deployment
  gates.
- Use `asNoTracking()` or projections for read-only work.
- Load relationships explicitly and bound collection includes.
- Parameterize raw SQL and treat `fromSqlUnsafe` as a filter boundary.
- Reload tracked entities after set-based updates or deletes.
- Keep sensitive diagnostics disabled outside controlled local debugging.
- Handle concurrency conflicts and unknown transaction outcomes explicitly.
- Test the exact provider and migration path used in production.
