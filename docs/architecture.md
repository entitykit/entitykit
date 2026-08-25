# Architecture

EntityKit is a six-package Node.js workspace built around one rule: core owns
ORM semantics and shared SQL contracts; providers own driver, session, and
database-integration behavior. Public package entries are the only seams
allowed to cross that boundary.

## Package ownership

| Package | Owns | Does not own |
| --- | --- | --- |
| `@entitykit/core` | Context lifecycle, model metadata, typed query models, SQL contracts and builders, materialization, change tracking, save planning, migrations, diagnostics, and provider-neutral configuration | A concrete driver, pool, live database connection, or CLI process |
| `@entitykit/sqlite` | `node:sqlite` connection behavior, SQLite dialects, value mapping, errors, schema introspection, and provider registration | Context, tracking, or query policy |
| `@entitykit/postgres` | `pg` pool and sessions, assembly and re-export of shared Postgres dialects, value mapping, errors, schema introspection, provider query helpers, and provider registration | Context, tracking, or query policy |
| `@entitykit/mysql` | `mysql2` pool and sessions, MySQL dialects, value mapping, errors, schema introspection, and provider registration | Context, tracking, or query policy |
| `@entitykit/cli` | Argument parsing, project/config discovery, migration and `db pull` orchestration, scaffolding, and terminal/JSON output | ORM semantics or provider implementations |
| `@entitykit/testing` | Provider-neutral recording connections and transaction test doubles | Production database emulation |

Core publishes focused secondary entries:

- `/adapter` for provider contracts and low-level extension primitives;
- `/migrations` for migration authoring and execution;
- `/tooling` for generated-code and module-loading support;
- `/experimental` for explicitly unstable compiler and builder internals.

## Dependency rules

The architecture suites under [`tests/architecture`](../tests/architecture/)
make these rules executable:

1. Core never statically imports a provider package or driver. Built-in
   convenience methods reach providers through narrow lazy bridges.
2. Provider, CLI, and testing packages import core only through declared public
   package entries. No relative import may escape the package that owns it.
3. Core never points back to a provider, CLI, or testing package in the runtime
   dependency graph.
4. The model layer is independent of context orchestration, query execution,
   SQL generation, and schema generation.
5. Migrations are independent of `DbContext` and the core orchestration layer.
6. Compatibility facades contain re-exports only and are not used as internal
   implementation dependencies.
7. The complete six-package runtime graph is acyclic.
8. TypeScript modules use specific kebab-case names. Source modules stay at or
   below 150 lines; tests and dogfood modules stay at or below 350 lines, with
   tighter budgets on high-pressure owners.

These are review constraints, not suggestions. If a change needs a new
dependency direction, first define a smaller contract in the owning inner
layer and cover the direction with an architecture test.

## Context construction

```text
DbContext.create()
  -> synchronous configure(options)
  -> synchronous model(builder)
  -> validate provider, model, and tenant-scope contracts
  -> initialize connection/data-source, dialect, model, and tracker
  -> expose DbSet gateways and optional lazy-navigation coordination
```

Constructors stay synchronous. `DbContext.create()` performs the one-time
bootstrap and rejects asynchronous `configure()` or `model()` callbacks. A
model with a tenant key is rejected unless the context configures either a
tenant resolver or an explicit cross-tenant mode.

The public `DbContext` delegates to focused runtime hosts for query filters,
relationships, migrations, raw SQL, transaction coordination, and the unit of
work. Disposal closes only resources owned by the context or its data source.

## Query flow

```text
DbSet / query proxy
  -> immutable QueryModel snapshot
  -> soft-delete and tenant filters
  -> provider-neutral SQL compiler + provider dialect
  -> SqlStatement { text, values }
  -> provider connection or row stream
  -> provider value reader
  -> materializer
  -> optional identity-map tracking and relationship loading
  -> diagnostics
```

Selectors produce expression objects; EntityKit never parses JavaScript
function source. Values are bound through the dialect's parameter placeholders
and remain separate from SQL text.

Tracked entity queries materialize through the identity map and snapshot
tracker. Projections and aggregate results are plain result objects. Includes
run through explicit loading strategies after the root query. Streaming holds
any pooled provider lease only for iteration and performs cancellation checks
at the provider boundary.

`fromSqlUnsafe` deliberately takes a shorter route: caller-owned SQL executes
without ORM filters and materializes untracked entities by default. The
template values are still parameterized, but the SQL text, result shape, and
authorization are the caller's responsibility.

## Save flow

```text
tracked entries and relationship journals
  -> detect scalar and relationship changes
  -> apply tenant, audit, soft-delete, generated-value, and outbox writes
  -> build and order a provider-neutral SavePlan
  -> run saving interceptors and rebuild if needed
  -> execute parameter-sized statements in a transaction or savepoint
  -> hydrate generated values and stage tracker acceptance
  -> commit, then finalize snapshots and post-commit callbacks
```

Save planning and execution run inside a restoration scope. A failed plan,
statement, generated-value write, interceptor, transaction, or outer rollback
attempts every registered restoration in reverse ownership order while
preserving the original failure. Entries remain retryable when restoration is
complete.

When `saveChanges()` runs inside an explicit outer transaction, tracker
acceptance remains rollback-capable until that transaction commits. If commit
outcome is unknown, or an in-memory restoration cannot be verified, the
context is marked unusable rather than guessing which state won.

## Provider flow

`DatabaseProviderServices` is the composition seam. A provider supplies its
runtime dialect, migration dialect/builder, connection or data source, value
reader, schema introspector, error classification, and capability signals.

Core consumes those contracts without knowing the driver. Each first-party
provider assembles the public provider surface from its own integration code
and the shared contracts. Postgres-compatible SQL rendering is shared from
core's adapter entry; SQLite and MySQL keep their dialect implementations in
their provider packages. The assembled provider owns:

- driver loading and missing-driver errors;
- pooling, sessions, streaming, transactions, and savepoints;
- placeholder and identifier syntax;
- store-value conversion and generated-value reading;
- provider error mapping and uncertain commit classification;
- schema introspection and migration-specific SQL.

Adding a provider should not add a provider name to core query, tracking, or
save modules. Provider-specific query helpers belong in the provider package
and compile down to the existing core expression contracts.

## CLI and migration flow

```text
entitykit command
  -> discover and execute project configuration
  -> resolve context + provider services
  -> discover migration modules or introspect schema
  -> validate checksums, history, locks, and data-loss approval
  -> print a dry-run plan or execute on a pinned provider session
  -> write generated files atomically
```

Migration history records the EntityKit migration version and checksum.
Postgres uses an advisory lock, MySQL uses a database-scoped named lock, and
SQLite reports that no provider lock was used. Generated migration and `db
pull` output is review material, not a substitute for reviewing the target
database.

## Release flow

```text
manual dispatch from main + publish-alpha confirmation
  -> complete CI matrix
  -> build and pack exactly six workspaces once
  -> install and accept those exact tarballs as an external consumer
  -> publish absent versions under alpha-candidate with npm provenance
     or accept an existing version only when its integrity matches
  -> compare all six registry integrities with the accepted tarballs
  -> move all six alpha dist-tags
```

The publish job has no checkout and cannot rebuild the packages. Re-dispatch is
safe only when an already-published version has the same registry integrity;
different bytes under the same version stop the release. Promotion verifies
every package before moving the first `alpha` tag. Exact core peer versions and
the package smoke test preserve a single core instance across the family.

See [compatibility](compatibility.md) for the qualified matrix and
[CONTRIBUTING](../CONTRIBUTING.md) for the change contract.
