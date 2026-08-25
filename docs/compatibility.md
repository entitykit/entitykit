# Compatibility

EntityKit's alpha contract is intentionally narrow. Package engine ranges say
what npm may install; the matrices below say what the release gate actually
proves. Rows marked qualified describe required release lanes, not the live
status of an arbitrary commit; a release is publishable only after every lane
passes on its exact source revision.

## Runtime

| Runtime | Alpha status | Boundary |
| --- | --- | --- |
| Node.js 22.13.0 | Qualified baseline | Runs the complete verify gate, builds release artifacts, and drives the coverage, mutation, Postgres, and MySQL lanes. This is the minimum supported version. |
| Node.js 24 | Qualified | Runs the complete `npm run verify` gate. |
| Other Node.js versions from 22.13 onward | Expected to work | Allowed by the package manifests, but not every minor or patch is a separate CI lane. |
| Node.js before 22.13 | Unsupported | Outside `engines`; the SQLite provider also depends on the built-in `node:sqlite` module available at the supported baseline. |
| Browsers, edge workers, Deno, and Bun | Unsupported | EntityKit is a Node.js library and uses Node database drivers, filesystem APIs, and module loading. |

Release qualification currently runs on `ubuntu-latest`. macOS and Windows are
not separate release lanes during the alpha.

## Modules and TypeScript

The published artifacts are CommonJS. Node can consume them from either module
system, and the package gate installs the packed tarballs into an otherwise
empty application before testing them.

| Consumer | Qualified | What is proved |
| --- | --- | --- |
| CommonJS `require()` | Yes | Runtime query, tracking, and save behavior against a real SQLite database. |
| ESM `import` | Yes | Node's ESM-to-CommonJS interoperability against the same installed artifacts. |
| TypeScript `module: Node16` | Yes | Strict typechecking with `skipLibCheck: false`. |
| TypeScript `module: NodeNext` | Yes | Strict ESM typechecking from an `.mts` consumer with `skipLibCheck: false`. |
| Native ESM output | No | EntityKit does not publish a second ESM build in this alpha. |
| Bundler-specific resolution | Not qualified | Deep imports and undeclared entry points are unsupported. |

The build target is ES2022. The public entry points are:

- `@entitykit/core`
- `@entitykit/core/adapter`
- `@entitykit/core/migrations`
- `@entitykit/core/tooling`
- `@entitykit/core/experimental`
- the root entry of each provider, CLI, and testing package

Only paths declared in a package's `exports` map are public. The package smoke
test covers every declared entry from the actual tarballs; repository-relative
or `dist/` deep imports are not compatibility contracts.

## Providers

| Provider | Package | Driver | Directly qualified database | Driver boundary |
| --- | --- | --- | --- | --- |
| SQLite | `@entitykit/sqlite` | Node's built-in `node:sqlite` | The SQLite library bundled with Node 22.13.0 and Node 24 | No external driver install. Some Node 22 releases may still print an informational `ExperimentalWarning`. |
| Postgres | `@entitykit/postgres` | `pg ^8.21.0` | Postgres 18 | Install `pg`; the provider loads it only when a Postgres connection is created. |
| MySQL | `@entitykit/mysql` | `mysql2 ^3.23.2` | MySQL 8.4 | Install `mysql2`; the provider loads it only when a MySQL connection is created. |
| Custom | `@entitykit/core/adapter` | Provider-owned | Not qualified by EntityKit | The adapter contracts are public alpha APIs. A third-party provider owns its database and driver support claims. |

Postgres 18 and MySQL 8.4 are the server versions exercised by the live CI
lanes. Other server versions may work, but they are not release-qualified by
this alpha.

### Provider feature matrix

| Capability | SQLite | Postgres | MySQL |
| --- | --- | --- | --- |
| Typed queries, tracking, relationships, and saves | Yes | Yes | Yes |
| Transactions and nested savepoints | Yes | Yes | Yes |
| Transaction isolation | `serializable`, `readUncommitted` | All four public levels | All four public levels |
| Read-only transactions | Yes | Yes | Yes |
| Streaming queries | Yes | Yes | Yes |
| Upsert conflict target | Primary or mapped unique key | Primary or mapped unique key | Primary key only, on a model without secondary unique keys |
| Migration concurrency lock | No provider lock | Advisory lock | Named lock |
| Idempotent migration scripts | No | Yes | No |
| Sequences, covering indexes, concurrent index creation, and extensions | No | Yes | No |
| Partial indexes | Yes | Yes | No |
| Transactional migration DDL | Yes, subject to SQLite rebuild rules | Yes, except explicitly transaction-suppressed operations | No; MySQL DDL commits implicitly |

SQLite cannot alter a column in place, add or drop table constraints, or rename
an index. EntityKit rebuilds the table from modeled columns, constraints, and
indexes; database objects outside the model, including custom triggers, must be
preserved manually.

### SQLite

SQLite uses Node's built-in driver and needs no external dependency. Its small
isolation surface, modeled table rebuilds, and lack of a provider migration lock
are the main deployment boundaries.

### Postgres

Postgres has the broadest migration surface, including advisory locking,
idempotent scripts, sequences, extensions, and concurrent indexes. Operations
explicitly marked transaction-suppressed still require separate failure review.

### MySQL

MySQL uses a database-scoped named migration lock on one pinned session, but its
DDL commits implicitly. A failed migration may therefore leave schema changes
behind without a matching history row. Its upsert syntax reacts to any unique
conflict, so EntityKit rejects ambiguous secondary-unique-key models instead of
silently updating the wrong row.

## Alpha boundaries

| Area | Contract for `0.1.0-alpha` |
| --- | --- |
| Public APIs | May change between alpha releases. Test an upgrade against the application's real schema, queries, and migrations. |
| Experimental entry | `@entitykit/core/experimental` has no compatibility guarantee during the alpha. |
| Package family | All six packages are released at one version. Providers, CLI, and testing use an exact peer on core; mixed EntityKit versions are unsupported. |
| Context lifecycle | A `DbContext` is a short-lived unit of work. Overlapping `saveChanges()` calls are rejected; use separate contexts for concurrent units of work. |
| Tenant scope | Typed queries and writes enforce configured scope. `ignoreTenantScope()`, cross-tenant contexts, raw SQL, and direct connection access are explicit bypasses, not authorization. |
| Migration generation | Generated migrations require review. Renames need explicit hints; destructive forward plans require `--allow-data-loss`; rollback plans can also lose data without that gate. Use `db migrate --dry-run` before applying either direction. |
| Database-first generation | `db pull` emits `TODO` comments and `Review required:` diagnostics for schema it cannot model safely. Unsupported details are not silently approximated. |
| SQLite migrations | Table rebuilds reproduce modeled schema only. Keep a backup and account for hand-authored triggers or other out-of-model objects. |
| MySQL migrations | A failure after DDL begins can leave part of a migration applied because MySQL commits DDL implicitly. |
| MySQL schema bootstrap | `ensureCreated()` and `createScript()` may include unguarded index DDL. Treat them as one-time creation plans, not repeatable reconciliation. |
| Platform surface | Node.js only; no browser, edge, alternative-runtime, native-ESM, or bundler support claim yet. |

The executable sources for these claims are the [CI matrix](../.github/workflows/ci.yml),
[package acceptance test](../scripts/check-package.js), and
[architecture tests](../tests/architecture/). Security-sensitive boundaries are
documented in the [security policy](../SECURITY.md).
