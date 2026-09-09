# API reference

This reference covers EntityKit's application-facing packages and entry points.
For task-oriented examples, start with the [usage guide](./USAGE.md). Provider
differences and prerelease guarantees live in
[compatibility](./docs/compatibility.md).

EntityKit is in alpha. The public TypeScript declarations shipped with each
package are the canonical source for every generic and overload.

This reference describes the coordinated `0.1.0-alpha.2` source family. The
previous `0.1.0-alpha.1` registry family contains core, the three providers,
CLI, and testing; it has neither `@entitykit/nestjs` nor the source-backed
`DbContext` constructor documented below.

## Entry points

| Import | Purpose |
| --- | --- |
| `@entitykit/core` | Contexts, models, queries, tracking, errors, and configuration |
| `@entitykit/core/migrations` | Migration authoring, diffing, discovery, scripts, and execution |
| `@entitykit/core/tooling` | Schema snapshots, `db pull` generation, and atomic generated-file writes |
| `@entitykit/core/adapter` | Contracts for database providers and custom data sources |
| `@entitykit/core/experimental` | Unstable compiler and builder internals |
| `@entitykit/sqlite` | SQLite provider backed by Node's `node:sqlite` |
| `@entitykit/postgres` | Postgres provider backed by `pg` |
| `@entitykit/mysql` | MySQL provider backed by `mysql2` |
| `@entitykit/cli` | CLI execution, metadata, config loading, and connection resolution |
| `@entitykit/testing` | Provider-neutral recording database connection |
| `@entitykit/nestjs` | NestJS 12 module, context runners, and injection tokens; begins in `alpha.2` |

## Data-source lifecycle

`EntityKitDataSource` owns application-scoped provider resources and creates
short-lived contexts. Each first-party provider exports a factory:

```ts
import { createSqliteDataSource } from "@entitykit/sqlite";

const dataSource = createSqliteDataSource("./app.db", {
  retry: { maxAttempts: 3 },
});
```

```ts
interface EntityKitDataSource<TConfig extends object> {
  readonly providerName: string;

  createContext<
    TContext extends object,
    TArguments extends unknown[],
  >(
    contextType: EntityKitContextFactory<TConfig, TContext, TArguments>,
    ...arguments_: NoInfer<TArguments>
  ): TContext;

  executeWithRetry<TResult>(
    operation: (attempt: RetryAttempt) => TResult | Promise<TResult>,
    options?: RetryExecutionOptions,
  ): Promise<TResult>;

  dispose(): Promise<void>;
}
```

Create one data source for the application, a fresh context for each request,
job, or unit of work, and dispose that context on every path. Dispose the data
source only after all contexts and retry operations finish during application
shutdown.

`createSqliteDataSource`, `createPostgresDataSource`, and
`createMySqlDataSource` accept provider configuration plus optional
`EntityKitDataSourceOptions`. An `executeWithRetry()` callback may run more than
once, so keep non-database side effects outside it or make them idempotent. It
never retries an unknown transaction outcome. A data source rejects new work
after disposal and rejects disposal while connection leases or retry operations
are active.

## `DbContext`

Derive one context class for a unit of work. Declare sets as fields and map
entities in `model()`. Passing a data source to the optional constructor selects
that source by convention.

```ts
abstract class DbContext {
  constructor(dataSource?: DatabaseDataSource);
  static create<TContext>(...args): TContext;

  protected configure(options: DbContextOptionsBuilder): unknown;
  protected model(model: ModelBuilder): unknown;

  readonly database: DatabaseFacade;
  readonly changeTracker: ChangeTracker;

  set<TEntity, TKey extends readonly unknown[] = readonly unknown[]>(
    entityType,
  ): DbSet<TEntity, TKey>;
  entry<TEntity>(entity): EntityEntry<TEntity> | undefined;
  entryOrThrow<TEntity>(entity): EntityEntry<TEntity>;
  saveChanges(options?): Promise<number>;
  clearTracking(): void;
  clearChanges(): void; // Deprecated alias for clearTracking().
  getSavePlan(): readonly SavePlanEntry[];
  getSavePlanDebugView(): string;
  transaction<TResult>(work, options?): Promise<TResult>;
  link(source, navigation, target): void;
  unlink(source, navigation, target): void;
  dispose(): Promise<void>;
}
```

`create()` synchronously constructs and initializes the context. Database work
remains asynchronous. A context also implements `Symbol.asyncDispose`, so it
can be owned by `await using`.

`EntityKitContextFactory` includes a public constructor that accepts the data
source first. `createContext()` infers its context and trailing argument tuple
from that constructor; the static `create()` method and supplied arguments must
conform to that tuple. An inherited generic static method cannot erase missing
or incorrectly typed constructor arguments.

`DatabaseDataSource` is the low-level contract exported from
`@entitykit/core/adapter`. First-party provider factories return the richer
`EntityKitDataSource` subtype exported from `@entitykit/core`.

Use one short-lived context per unit of work. Concurrent operations on the same
context are rejected.

```ts
class AppDbContext extends DbContext {
  readonly users = this.set<User, [id: string]>(User);
}

await using db = dataSource.createContext(AppDbContext);
```

When a source-backed context overrides `configure()`, it must call
`super.configure(options)` before adding non-provider options. The direct
`useSqlite()`, `usePostgres()`, and `useMySql()` methods instead create a
context-owned connection; they are concise for scripts, migration contexts,
and isolated tests, but a server should not use them to create a new Postgres
or MySQL pool for every request.

### `database`

`DatabaseFacade` exposes high-level schema and raw-SQL operations:

| Operation | Result |
| --- | --- |
| `ensureCreated(options?)` | Executes the provider's complete creation plan for a new or disposable database |
| `createScript()` | Returns the complete provider-specific creation SQL without executing it |
| `` sql<TRow>`...${value}...` `` | Runs a parameterized query and returns rows |
| `` execute`...${value}...` `` | Runs a parameterized command and returns affected rows |
| `` rawSql`...${value}...` `` | Builds an unexecuted `SqlStatement` |
| `executeStatement(statement, options?)` | Executes an existing parameterized statement |
| `withOptions(options)` | Returns a facade carrying an `AbortSignal` |
| `connection` | Advanced provider-neutral `DatabaseConnection` escape hatch |

Template values are always bound separately from SQL text.

Creation plans are not a schema-diff mechanism and are not universally
idempotent. In particular, MySQL models can emit unguarded index DDL. Use
migrations for repeatable schema evolution.

## `DbSet<TEntity>`

A set is both the tracked gateway for one entity type and the start of an
immutable query.

| Operation | Behavior |
| --- | --- |
| `find(...keyValues)` | Returns a tracked entity by key or `null` |
| `findOrThrow(...keyValues)` | Returns a tracked entity or throws `EntityNotFoundError` |
| `create(...arguments)` | Constructs and tracks one new entity as added; returns the entity without executing SQL |
| `add(entity)` | Tracks an entity as added |
| `attach(entity)` | Tracks an existing entity without scheduling an insert |
| `remove(entity)` | Marks a tracked entity for deletion |
| `detach(entity)` | Removes an entity from the context identity map |
| `executeUpsert(entities, options?)` | Performs set-based upsert within the provider's conflict-target rules |
| `` fromSqlUnsafe`...${value}...` `` | Materializes caller-owned SQL without automatic query filters |

`set(User)` infers the public constructor's argument tuple for `create()`.
`set<typeof User, [id: string]>(User)` also types the key. Identity-only
registrations and existing `set<User, [string]>(User)` calls remain supported,
but cannot call `create()` without retaining a constructor or factory type.
The exported `EntityConstructor` remains an identity contract with no required
constructor signature.

`set(User, { create: factory })` binds an explicit synchronous factory to the
returned gateway. Its arguments define the creation input. For an explicit
key tuple, use `set<User, typeof factory, [id: string]>(User, { create: factory })`.
The gateway shares tracking with all other sets in the context; its factory
does not change their construction behavior. Default `set(User)` lookups
continue to return the cached constructor-backed set.

The entity identity determines the mapped set type; only the argument tuple
comes from the factory. A subclass result is accepted, but queries and
`create()` remain typed as the mapped entity. A broad `object` result or a
union containing an incompatible result is rejected. When the factory itself
is a union of possible callables, creation arguments must satisfy every
possible signature; a single factory accepting a union input retains that input.

Factories run unbound (`this` is `undefined`). Explicitly receiver-dependent
methods must be bound to their owner or wrapped in a closure.

For an overloaded factory, `create()` uses the final declared signature. That
signature must return the mapped entity and work unbound. Select a different
overload with a typed closure, such as `(id: string) => makeUser(id)`.

`EntityCreationFactory<TEntity, TArguments>` and
`EntityCreationConstructor<TEntity, TArguments>` preserve explicitly annotated
argument tuples. Their default `never` does not permit calls. Use `satisfies`
when checking a factory without erasing its inferred inputs, or provide an
explicit tuple (`[]` for an actual zero-argument factory). Annotating a set as
`DbSet<User>` also erases creation arguments; prefer inference or retain the
creation tuple as the third `DbSet` type argument.

`create()` runs the constructor or factory once, validates that it returned an
instance of the mapped class, and delegates enrollment to the ordinary add
path. It rejects promises and already-tracked instances before enrollment.
It preserves defaults and private state without a property-assignment pass,
applies tenant rules, and stages one entity without recursive graph insertion.
Failed enrollment uses the same tracking and tenant restoration as `add()`.
Creation input typing is not runtime request validation.

Reads use the independent `entity.materialize(factory)` mapping. Supply one
for classes whose constructor requires input. `saveChanges()` persists created
entities; use detached constructors or domain factories to prepare `executeUpsert()`
inputs. Existing `add()`, `attach()`, and `remove()` return `EntityEntry`.

`upsert()` remains a deprecated alias for `executeUpsert()` with the same
immediate execution behavior.

`executeUpsert()` accepts `conflictProperties` and `updateProperties`. It bypasses the
change tracker, save interceptors, audit fields, concurrency tokens, and outbox
events. Postgres and SQLite can target a mapped unique key. MySQL accepts only
the primary key on models without secondary unique keys because its clause can
fire on any unique conflict.

`fromSqlUnsafe()` still binds interpolated values, but the SQL shape and the
decision to bypass tenant and soft-delete filters belong to the caller. It is
untracked by default; call `.asTracking()` only when the query returns the
complete mapped shape.

## Queries

Query builders are immutable. Every method returns a new query; execution begins
only at a terminal operation.

### Predicates

Mapped fields expose operators based on their TypeScript type:

| Shape | Operators |
| --- | --- |
| Every field | `eq`, `ne`, `in`, `isNull`, `isNotNull` |
| Strings | `like`, `contains`, `startsWith`, `endsWith` |
| Numbers, strings, and dates | `gt`, `gte`, `lt`, `lte` |
| Ordering | `asc`, `desc` |

Predicates compose with `.and()`, `.or()`, and `.not()`.

```ts
const users = await db.users
  .where(user =>
    user.email.endsWith("@example.com")
      .and(user.createdAt.gte(cutoff)),
  )
  .orderByDescending(user => user.createdAt)
  .take(20)
  .toArray();
```

### Composition

| Operation | Purpose |
| --- | --- |
| `where(selector)` | Adds a typed predicate |
| `whereIf(condition, selector)` | Adds a predicate only when a condition is true |
| `whereHas(navigation, predicate?)` | Adds a related-row `exists` predicate |
| `whereDoesNotHave(navigation, predicate?)` | Adds a related-row `not exists` predicate |
| `orderBy` / `orderByDescending` | Adds ordering |
| `skip` / `take` | Adds paging |
| `include` / `thenInclude` | Loads configured relationship graphs with split queries |
| `select` | Projects an untracked typed read model |
| `join` / `leftJoin` | Builds a flat multi-source read query |
| `aggregate` | Selects aggregate values |
| `groupBy` | Starts a grouped aggregate query |
| `asNoTracking` | Materializes entities without adding them to the identity map |
| `ignoreQueryFilters` | Bypasses configured global query filters |
| `ignoreTenantScope` | Bypasses tenant filtering explicitly |

Includes are unavailable on streamed queries because a split graph must be
completed before it can be returned consistently.

### Terminals

| Operation | Result |
| --- | --- |
| `toArray(options?)` | All rows |
| `stream(options?)` | `AsyncIterable` with provider backpressure |
| `firstOrNull(options?)` | First row or `null` |
| `first(options?)` | First row or `EntityNotFoundError` |
| `singleOrNull(options?)` | One row, `null`, or `MultipleEntitiesFoundError` |
| `single(options?)` | Exactly one row |
| `count(options?)` | JavaScript `number` count |
| `countBigInt(options?)` | Precision-preserving `bigint` count |
| `exists(options?)` | Whether a row exists |
| `executeUpdate(values, options?)` | Set-based update count |
| `executeDelete(options?)` | Set-based delete count |

`executeUpdate()` and `executeDelete()` require an explicit `where()` predicate.
They bypass tracking and save lifecycle hooks while retaining tenant and
soft-delete filters unless the query explicitly opts out.

### Inspection

| Operation | Result |
| --- | --- |
| `toSql()` | `{ text, values }` with bound parameters separate |
| `toDebugSql()` | SQL with parameter values redacted and their types retained |
| `toDebugSql({ includeSensitiveData: true })` | SQL with formatted values; never use in production logs |
| `toPlan()` | Versioned, serializable query plan |

## Model mapping

`ModelBuilder` owns the runtime model:

```ts
interface ModelBuilder {
  entity<TEntity>(ctor, configure): this;
  applyConfiguration<TEntity>(configuration): this;
  hasSequence(name, configure?): this;
}
```

### Entity mapping

| `EntityBuilder` operation | Purpose |
| --- | --- |
| `toTable(name, schema?)` | Maps a writable table |
| `toView(name, schema?)` | Maps a read-only view |
| `hasNoKey()` | Declares a keyless read model |
| `hasSchema(name)` | Sets the database schema |
| `hasKey(selector)` | Configures a primary key, including composite keys |
| `hasAlternateKey(selector)` | Configures a relationship target other than the primary key |
| `hasIndex(selector)` | Configures a property index |
| `hasExpressionIndex(sql)` | Configures provider-specific expression indexes |
| `hasCheckConstraint(name, sql)` | Adds a table check constraint |
| `property(selector)` | Configures one scalar property |
| `complexProperty(selector, options?, configure?)` | Maps a nested value object |
| `ignore(selector)` | Excludes a property |
| `hasOne(...).withOne/withMany(...)` | Configures reference relationships |
| `hasManyToMany(...).withMany(...)` | Configures a join-table relationship |
| `audit(config)` | Names audit properties |
| `softDelete(...)` | Configures a soft-delete marker |
| `tenantKey(...)` | Configures the tenant ownership property |
| `materialize(factory)` | Supplies explicit entity rehydration |
| `materializeChecked(factory)` | Supplies checked scalar access for constructor-based rehydration |

The [rehydration guide](docs/materialization.md) defines `required()` and
`nullable()`, supported scalar checks, and guards for converted domain values.

### Property mapping

`PropertyBuilder` supports column names and types, required/optional values,
unique constraints, maximum lengths, literal and SQL defaults, computed
columns, collations, concurrency tokens, version columns, store-generated
values, identity/auto-increment/SQLite-rowid/sequence generation, and
`ValueConverter` mappings.

Built-in converters include `enumString`, `numericAsString`,
`numericAsNumber`, `bigintAsBigInt`, `bigintAsNumber`, `dateOnlyAsString`, and
`dateOnlyAsUtcDate`.

### Relationships

Reference relationships configure `withOne` or `withMany`, foreign and
principal keys, delete behavior, and constraint names. Many-to-many
relationships configure the inverse navigation, join table, join columns,
schema, constraint names, and delete behavior.

Delete behavior controls generated database constraints. EntityKit does not
silently walk an unloaded object graph to emulate database cascades.

## Context options

`DbContextOptionsBuilder` is supplied to `configure()`:

| Operation | Purpose |
| --- | --- |
| `useSqlite(config)` | Selects the built-in SQLite provider |
| `usePostgres(config)` | Selects the built-in Postgres provider |
| `useMySql(config)` | Selects the built-in MySQL provider |
| `useProvider(services, config)` | Selects explicit or custom provider services |
| `useDataSource(dataSource)` | Uses a retrying/provider-neutral data source |
| `useConnection(connection, options?)` | Uses an existing provider-neutral connection |
| `useSaveInterceptor(interceptor)` | Observes or participates in save lifecycle |
| `useDiagnostics(handler, options?)` | Receives redacted runtime diagnostics |
| `useAuditing(options?)` | Populates mapped audit fields |
| `useTenantScope(() => currentTenantId)` | Applies tenant ownership to queries and writes |
| `allowCrossTenantAccess()` | Explicitly creates a cross-tenant context |
| `useLazyLoading(options?)` | Enables awaitable relationship loading with an optional budget |
| `useOutbox(options)` | Persists collected domain events in the save transaction |

Provider configs accept connection strings or typed options. Postgres and MySQL
also expose TLS, pool, timeout, and driver escape-hatch options. SQLite accepts
file/read-only, foreign-key, busy-timeout, and journal-mode options.

`useDataSource()` is called automatically by the base `DbContext.configure()`
when the optional constructor receives a data source.

## Tracking and concurrency

`ChangeTracker` exposes `entry`, `entries`, `detach`, `detectChanges`,
`acceptAllChanges`, `clear`, and `debugView`.

`EntityEntry<TEntity>` exposes the entity, state, key, original and current
values, modified properties, database values, reload, concurrency resolution,
and explicit relationship loaders:

```ts
await db.entryOrThrow(post).reference(item => item.author).load();
await db.entryOrThrow(user).collection(item => item.posts).load();
```

When lazy loading is enabled, `lazy(entity).navigation` returns an awaitable
navigation without replacing the entity with a proxy or hiding I/O behind a
property read.

`DbUpdateConcurrencyError` identifies the entity, key, state, affected row
count, and conflicting tracked entry. `EntityEntry.resolveConcurrency()`
accepts `clientWins` or `databaseWins`.

## Errors

The `EntityKitError` family carries a stable `code`, optional structured
`details`, and a JSON-safe `toJSON()` representation. `isEntityKitError()`
recognizes that family without relying only on one package realm.

The root package exports typed `EntityKitError` subclasses for:

- model and database validation;
- query compilation, missing rows, and multiple rows;
- update, unique, foreign-key, not-null, and optimistic-concurrency failures;
- disposed, uninitialized, concurrent-operation, cancellation, and restoration
  failures;
- unsupported provider capabilities;
- tenant scope and ownership;
- navigation ownership and loading.

Provider, transaction-cleanup, and uncertain-commit errors are separate typed
`Error` classes with structured fields and `toJSON()` output. Migration errors
come from `@entitykit/core/migrations`; they cover checksum drift, data-loss
approval, execution, lock release, and pending model changes.

## Migrations

Import migration authoring and execution APIs from
`@entitykit/core/migrations`.

| Area | Main exports |
| --- | --- |
| Authoring | `Migration`, `MigrationBuilder`, migration statement and table/column types |
| Execution | `MigrationRunner`, `MigrationSqlGenerator`, `contextMigrations`, `renderScript` |
| Model changes | `diffModelSnapshots`, model diff operations, rename hints |
| Scaffolding | `scaffoldMigration`, `writeMigrationScaffold`, snapshot read/render helpers |
| Discovery | `discoverMigrations`, `loadMigrationFile`, add/remove/list/check commands |
| Integrity | `migrationChecksum`, migration metadata constants, typed migration errors |

Applied migrations record their id, name, checksum, and EntityKit version.
Generated migration files and scripts must be reviewed before deployment.

## Tooling and adapters

`@entitykit/core/tooling` exposes neutral schema snapshots, `generateDbPullCode`,
TypeScript module loading, path validation, and atomic file writing.

`@entitykit/core/adapter` exposes the contracts needed to implement a provider:
connections, data sources, provider services, SQL and migration dialects,
schema introspection, retry/cancellation/session primitives, value readers, and
the provider-neutral migration builder.

`@entitykit/core/experimental` exposes mutable compiler/building internals. It
has no compatibility guarantee during alpha and should not be used in ordinary
application code.

## Provider packages

Each provider package exports:

- provider services for explicit registration;
- a data-source factory;
- the concrete database connection;
- runtime and migration dialects;
- a schema introspector;
- a standalone parameterized `rawSql` tag;
- provider configuration and shared adapter types.

The provider-specific names are:

| Provider | Services | Data source | Connection | Introspector |
| --- | --- | --- | --- | --- |
| SQLite | `sqliteProviderServices` | `createSqliteDataSource` | `SqliteDatabaseConnection` | `SqliteSchemaIntrospector` |
| Postgres | `postgresProviderServices` | `createPostgresDataSource` | `PostgresDatabaseConnection` | `PostgresSchemaIntrospector` |
| MySQL | `mySqlProviderServices` | `createMySqlDataSource` | `MySqlDatabaseConnection` | `MySqlSchemaIntrospector` |

Postgres additionally exports a `postgres` helper object for provider-specific
mapped upsert/update/delete statements and date buckets.

## CLI

The installed executable is `entitykit`. Its commands are:

```text
init
migration add
migration remove
migration list
migration check
migration script
db migrate
db status
db pull
completion
```

Global options include `--config`, `--cwd`, `--json`, `-h` / `--help`, and
`-V` / `--version`. Run `entitykit <command> --help` for exact options and
examples.

The package also exports `runEntityKitCli`, config loading/definition,
connection resolution, CLI metadata/schema/completion functions, and
machine-readable result and error types.

## NestJS

`@entitykit/nestjs` is the native-ESM NestJS 12 integration introduced by the
coordinated `0.1.0-alpha.2` family. It does not exist in `0.1.0-alpha.1`.

| Export | Purpose |
| --- | --- |
| `EntityKitModule.forRoot(options)` | Registers one ready application-scoped data source |
| `EntityKitModule.forRootAsync(options)` | Resolves the root options through Nest dependency injection |
| `EntityKitModule.forFeature(contextTypes)` | Registers injectable runners for selected context classes |
| `EntityKitContextRunner<TContext>.run(work, ...args)` | Creates, awaits, and disposes one context per unit of work |
| `InjectEntityKitContextRunner(ContextType)` | Injects the runner registered for a context class |
| `InjectEntityKitDataSource()` | Injects the application data source for an advanced integration boundary |
| `getEntityKitContextRunnerToken(ContextType)` | Returns the underlying Nest injection token |
| `getEntityKitDataSourceToken()` | Returns the data-source injection token |

`EntityKitModuleOptions` accepts `dataSource` and optional ownership of
`"module"` or `"external"`. Module ownership is the default and disposes the
source during Nest application shutdown. External ownership leaves disposal to
the caller.

`EntityKitContextRunner.run()` forwards constructor arguments after the data
source. It preserves both errors in an `AggregateError` when the unit of work
and context disposal fail. The module intentionally does not provide raw
singleton or request-scoped contexts.

See the [framework guide](./docs/frameworks.md#nestjs-12) for registration,
injection, tenant arguments, ESM configuration, and shutdown ownership.

## Testing

`@entitykit/testing` exports `RecordingDatabaseConnection`. It records
statements, operations, transaction events, and provider-session events without
starting a database.

```ts
const connection = new RecordingDatabaseConnection();
connection.queueResult({ rows: [{ id: "usr_1" }] });
```

Use it through `options.useConnection(connection)`. Queue rows or errors, run
application code, then inspect `statements`, `operations`, `transactionEvents`,
and `sessionEvents`.
