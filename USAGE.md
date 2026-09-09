# Usage

EntityKit maps ordinary TypeScript classes to a database through an
application-scoped data source and short-lived `DbContext` units of work. This
guide follows the common path from the first model to a production migration.
The [documentation map](./docs/README.md) offers role-based routes; the
[API reference](./API.md) lists the public surface.

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
provider or driver until a data source or context selects one.

> [!IMPORTANT]
> This guide targets `0.1.0-alpha.2`. With the previous `0.1.0-alpha.1`, store
> the source on the context and select it with `options.useDataSource(source)`
> inside `configure()`.

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

type NewUser = { id: string; email: string; name: string };

class User {
  id: string;
  email: string;
  name: string;
  posts: Post[] = [];

  constructor(input: NewUser) {
    this.id = input.id;
    this.email = input.email;
    this.name = input.name;
  }
}

type NewPost = { id: string; authorId: string; title: string; status?: string };

class Post {
  id: string;
  authorId: string;
  title: string;
  status = "draft";
  author: User | null = null;

  constructor(input: NewPost) {
    this.id = input.id;
    this.authorId = input.authorId;
    this.title = input.title;
    this.status = input.status ?? "draft";
  }
}

export class AppDbContext extends DbContext {
  readonly users = this.set(User);
  readonly posts = this.set(Post);

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
      entity.materialize(values => {
        const { id, authorId, title, status } = values;
        if (typeof id !== "string" || typeof authorId !== "string" ||
            typeof title !== "string" || typeof status !== "string") {
          throw new Error("Cannot materialize Post: required fields are missing or invalid.");
        }
        return new Post({ id, authorId, title, status });
      });
      entity.hasOne(User, post => post.author)
        .withMany(user => user.posts)
        .hasForeignKey(post => post.authorId)
        .onDelete(DeleteBehavior.Cascade);
    });
  }
}
```

## Own the data source

Create one provider data source when the application starts. It owns the
provider's shared resources, including the Postgres or MySQL connection pool.

```ts
import { createSqliteDataSource } from "@entitykit/sqlite";

const dataSource = createSqliteDataSource("./app.db");
```

For another database, install its provider and use the matching factory:

```ts
import { createPostgresDataSource } from "@entitykit/postgres";
import { createMySqlDataSource } from "@entitykit/mysql";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const postgres = createPostgresDataSource(databaseUrl);
const mysql = createMySqlDataSource(databaseUrl);
```

Create a fresh context for each request, job, or other unit of work. Dispose the
context first; dispose the data source only during application shutdown.

```ts
const db = dataSource.createContext(AppDbContext);
try {
  // Await one unit of work through db.
} finally {
  await db.dispose();
}

// Application shutdown, after every context has been disposed:
await dataSource.dispose();
```

`DbContext` accepts the data source through its optional constructor, and
`EntityKitDataSource.createContext()` passes it automatically. Initialization
selects that source before calling `configure()`, so overrides can add
diagnostics, tenant scope, or auditing without calling `super.configure()`.
Existing base calls remain harmless. Selecting another provider, source, or
connection in the hook fails before a connection is acquired.

`createContext()` checks the actual context constructor: it must accept the
data source first, and required, optional, and rest arguments after that source
retain their types. For example, a constructor taking `(source, requestId:
string)` requires `dataSource.createContext(RequestContext, "request_1")`.

Direct `options.useSqlite()`, `options.usePostgres()`, and
`options.useMySql()` configuration remains useful for short-lived scripts,
migration contexts, and isolated tests. Each such context owns its connection;
for Postgres and MySQL, creating one per request would also create one pool per
request. Server applications should use an application-scoped data source.

## Create a database

`ensureCreated()` executes the provider's complete creation plan. Use it to
bootstrap a new test, local-tool, or disposable database—not to evolve or
repeatedly reconcile an existing schema.

```ts
await using db = dataSource.createContext(AppDbContext);
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
await using db = dataSource.createContext(AppDbContext);

const page = await db.users
  .where(user => user.email.endsWith("@example.com"))
  .orderBy(user => user.name)
  .skip(20)
  .take(20)
  .asNoTracking()
  .toArray();
```

Fields expose typed operators including `eq`, `ne`, `in`, comparisons, null
checks, and string matching. Callbacks receive query fields, not entity
instances. Chain `where()` calls to combine independent conditions with AND,
or use `and()`, `or()`, and `not()` for grouped predicates.

```ts
const matchingUsers = await db.users
  .where(user => user.name.eq(name))
  .where(user => user.email.eq(email))
  .toArray();
```

JavaScript `&&` and `||` discard predicate objects instead of combining them.
Enable the [supported typed lint rule](docs/query-predicates.md#enable-typed-linting)
in your application to catch this mistake in the editor and CI.

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
const posts = db.entryOrThrow(user).collection(candidate => candidate.posts);
if (!posts.isLoaded) await posts.load();
```

`entryOrThrow()` fails when this context does not track the object. An
initialized empty collection is not necessarily loaded: `isLoaded` records
whether EntityKit has deliberately loaded the navigation. Plain property
access never performs hidden I/O.

## Track and save changes

Create an entity, change a tracked entity, or mark one for removal, then call
`saveChanges()`. `create()` synchronously constructs the entity, tracks it as
added, and returns that same instance. It performs no database operation.

```ts
const created = db.users.create({
  id: "usr_2",
  email: "grace@example.com",
  name: "Grace",
});

await db.saveChanges();

const loaded = await db.users.findOrThrow("usr_2");
loaded.name = "Grace Hopper";

console.log(db.getSavePlanDebugView());
const affected = await db.saveChanges();
```

`this.set(User)` infers the constructor's complete argument tuple. A constructor
with no arguments permits `create()` with no arguments; EntityKit does not
infer required creation data from mapped properties. For typed `find()` keys,
use `this.set<typeof User, [id: string]>(User)`. Existing
`this.set<User, [string]>(User)` declarations retain their query and tracking
contracts; switch the first type argument to `typeof User` to enable typed
constructor creation.

Keep set declarations inferred: `readonly users = this.set(User)` preserves
creation arguments. An annotation such as `readonly users: DbSet<User> =
this.set(User)` erases those arguments and intentionally makes `create()`
unavailable. If an explicit set type is necessary, retain its input tuple, for
example `DbSet<User, [id: string], [input: NewUser]>`.

Creation factories can accept inputs that differ from persisted properties:

```ts
// A context field; its factory belongs only to this returned set.
readonly registrations = this.set(User, {
  create: (input: { id: string; email: string; displayName: string }) =>
    new User({ id: input.id, email: input.email, name: input.displayName.trim() }),
});
```

Factory-bound sets share the context's tracker. They do not replace the factory
or constructor used by another set reference. Factories must return a fresh
instance of the mapped class synchronously; promises and already-tracked
instances are rejected. Private constructors and domain creation policies can
use this explicit factory route. Factories are invoked unbound, with `this`
set to `undefined`; preserve a method receiver with
`userFactory.make.bind(userFactory)` or a closure such as
`(id: string) => userFactory.make(id)`.

The entity argument defines what the set contains. A factory may return a
subclass, but `set(User, { create: factory })` still queries and returns the
mapped `User` type. Broad `object` results and unions containing non-user
values do not satisfy that contract.

For a reusable factory, `satisfies` checks the result while preserving inputs:

```ts
import type { EntityCreationFactory } from "@entitykit/core";

const makeUser = (
  (input: NewUser) => new User(input)
) satisfies EntityCreationFactory<User>;
```

An explicit annotation should include the argument tuple, such as
`EntityCreationFactory<User, [input: NewUser]>`. Omitting the tuple erases the
inputs and makes creation unavailable; it does not mean the factory takes no
arguments. Use `EntityCreationFactory<User, []>` for a real zero-argument
factory. The same tuple rule applies to `EntityCreationConstructor`.

For an explicitly typed key on a factory-bound set, use
`this.set<User, typeof makeUser, [id: string]>(User, { create: makeUser })`.
Ordinary factory bindings need no explicit type arguments.

Creation runs the ordinary `add()` enrollment path, including tenant defaults
and rollback on failure. It does not recursively insert navigation objects.
The `materialize()` mapping above handles reads separately; reads never invoke
the set's creation factory. TypeScript contracts do not validate unchecked
request input, and EntityKit cannot roll back external side effects inside a
domain constructor or factory.

Use `new User(input)` for a detached object and `db.users.add(user)` when an
entity has already been constructed. `create()` returns the entity itself.

`add()`, `attach()`, and `remove()` return an `EntityEntry`. The entry exposes
original values, changed properties, database values, reload, and explicit
relationship loaders. `changeTracker.debugView()` shows the complete tracked
state without writing it.

`clearTracking()` abandons all tracked entities and pending relationship work
without executing SQL or reverting object properties. Changed objects retain
their current values. `clearChanges()` remains a deprecated alias.

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

Use detached objects from constructors or domain factories for `executeUpsert()`,
which writes immediately and bypasses tracking. The portable shape targets the
primary key on a model without secondary unique keys:

```ts
await db.posts.executeUpsert(
  [new Post({
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
  transaction.posts.create({
    id: "post_1",
    authorId: "usr_1",
    title: "Hello, EntityKit",
    status: "published",
  });

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
installed provider package, while the config helper comes from core. CLI
commands construct the configured context without application arguments, so
give them a small zero-argument context that owns its short-lived provider
connection:

```ts
import { type DbContextOptionsBuilder } from "@entitykit/core";
import { AppDbContext } from "./app-db-context";

export class MigrationDbContext extends AppDbContext {
  protected override configure(options: DbContextOptionsBuilder): void {
    options.useSqlite("./app.db");
  }
}
```

Keep model mapping in the shared base context so runtime and migration contexts
cannot drift. The configuration points the CLI at the migration-specific
context:

```ts
import { defineEntityKitConfig } from "@entitykit/core";
import { sqliteProviderServices } from "@entitykit/sqlite";
import { MigrationDbContext } from "./src/db/migration-db-context";

export default defineEntityKitConfig({
  context: MigrationDbContext,
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
  super.configure(options);
  options.useDiagnostics(event => {
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
- Validate connection configuration before creating the application data source.
- Create one application-scoped data source, then one short-lived context per
  request, job, or unit of work.
- Dispose each context before disposing the data source during application
  shutdown.
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
- Follow the [framework lifecycle guide](./docs/frameworks.md) for NestJS or
  Next.js applications.
