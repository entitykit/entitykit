# Compatibility

EntityKit is currently an alpha. Package engine ranges say
what npm may install; the matrices below say what the release gate actually
proves. Rows marked qualified describe required release lanes, not the live
status of an arbitrary commit; a release is publishable only after every lane
passes on its exact source revision.

## Runtime

| Runtime | Alpha status | Boundary |
| --- | --- | --- |
| Node.js 22.13.0 | Qualified baseline | Runs the complete verify gate, builds release artifacts, and drives the coverage, mutation, Postgres, and MySQL lanes. This is the minimum supported version. |
| Node.js 24 | Qualified | Runs the complete verify gate and both live database lanes, including recovery and performance qualification. |
| Other patches/minors of Node.js 22 and 24 from 22.13 onward | Expected to work | Allowed by the package manifests, but not every minor or patch is a separate CI lane. |
| Other Node.js majors | Unqualified | An engine range permits installation; a new major needs its own release campaign before support is claimed. |
| Node.js before 22.13 | Unsupported | Outside `engines`; the SQLite provider also depends on the built-in `node:sqlite` module available at the supported baseline. |
| Browsers, edge workers, Deno, and Bun | Unsupported | EntityKit is a Node.js library and uses Node database drivers, filesystem APIs, and module loading. |

Release qualification currently runs on `ubuntu-latest`. macOS and Windows are
not separate release lanes during the alpha.

## Modules and TypeScript

The published `0.1.0-alpha.2` family has six CommonJS packages and the
native-ESM `@entitykit/nestjs` integration. Node can consume the CommonJS
packages from either module system. The package gate installs all seven packed
tarballs into an otherwise empty application before testing them. The original
`alpha.1` family contains only the six CommonJS packages.

| Consumer | Qualified | What is proved |
| --- | --- | --- |
| CommonJS `require()` | Yes | Runtime query, tracking, and save behavior against a real SQLite database. |
| ESM `import` | Yes | Node's ESM-to-CommonJS interoperability against the same installed artifacts. |
| TypeScript `module: Node16` | Yes | Strict typechecking with `skipLibCheck: false`. |
| TypeScript `module: NodeNext` | Yes | Strict ESM typechecking from an `.mts` consumer with `skipLibCheck: false`. |
| Native ESM output | NestJS integration only | `@entitykit/nestjs` emits native ESM and is consumed from an ESM application. The six other packages expose CommonJS with Node ESM interoperability, without a second native-ESM build. |
| Bundler-specific resolution | Not qualified | Deep imports and undeclared entry points are unsupported. |

The build target is ES2022. The public entry points are:

- `@entitykit/core`
- `@entitykit/core/adapter`
- `@entitykit/core/migrations`
- `@entitykit/core/tooling`
- `@entitykit/core/experimental`
- the root entry of each provider, CLI, and testing package

The `@entitykit/nestjs` root entry is public in the published `alpha.2` family
and the `alpha.3` source candidate.

Only paths declared in a package's `exports` map are public. The package smoke
test covers every declared entry from the actual tarballs; repository-relative
or `dist/` deep imports are not compatibility contracts.

## Frameworks

| Integration | Status | Boundary |
| --- | --- | --- |
| NestJS 12 | Published since `alpha.2` | `@entitykit/nestjs` provides native-ESM `forRoot`, `forRootAsync`, `forFeature`, and context-runner lifecycle APIs. It did not exist in `0.1.0-alpha.1`. |
| Next.js 16 App Router, Node runtime | Repository example; not generally qualified | The [Postgres demo](../examples/nextjs-postgres/) shows the intended Node-only lifecycle and external-package configuration. It is not yet a compatibility claim for arbitrary Next.js applications or bundlers. |
| Next.js Edge, browser, or Client Component data access | Unsupported | EntityKit requires Node database drivers and server-only APIs. |

The [framework guide](frameworks.md) documents the supported ownership shape.
General Next.js or bundler support remains unqualified until a required gate
builds the exact packed artifacts and proves the live production runtime path.
A source example or source-only typecheck is not that gate.

## Providers

| Provider | Package | Driver | Directly qualified database | Driver boundary |
| --- | --- | --- | --- | --- |
| SQLite | `@entitykit/sqlite` | Node's built-in `node:sqlite` | The SQLite library bundled with Node 22.13.0 and Node 24 | No external driver install. Some Node 22 releases may still print an informational `ExperimentalWarning`. |
| Postgres | `@entitykit/postgres` | `pg ^8.21.0` | Postgres 18 | Install `pg`; the provider loads it only when a Postgres connection is created. |
| MySQL | `@entitykit/mysql` | `mysql2 ^3.23.2` | MySQL 8.4 | Install `mysql2`; the provider loads it only when a MySQL connection is created. |
| Custom | `@entitykit/core/adapter` | Provider-owned | Not qualified by EntityKit | The adapter contracts are public alpha APIs. A third-party provider owns its database and driver support claims. |

Postgres 18 and MySQL 8.4 are the server versions exercised by the live CI
lanes on Node 22.13 and Node 24. Other server versions may work, but they are not release-qualified by
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
| Package family | The published `alpha.2` and candidate `alpha.3` families have seven packages at one exact version. Coordinated releases move every included package together; mixed EntityKit versions are unsupported. The historical `alpha.1` family has six packages. |
| Context lifecycle | Create one provider data source per application, then one short-lived `DbContext` per request, job, or unit of work. Dispose the context first and the source at application shutdown. Overlapping operations on one context are rejected. |
| Tenant scope | Typed queries and writes enforce configured scope. `ignoreTenantScope()`, cross-tenant contexts, raw SQL, and direct connection access are explicit bypasses, not authorization. |
| Migration generation | Generated migrations require review. Renames need explicit hints; destructive forward plans require `--allow-data-loss`; rollback plans can also lose data without that gate. Use `db migrate --dry-run` before applying either direction. |
| Database-first generation | `db pull` emits `TODO` comments and `Review required:` diagnostics for schema it cannot model safely. Unsupported details are not silently approximated. |
| SQLite migrations | Table rebuilds reproduce modeled schema only. Keep a backup and account for hand-authored triggers or other out-of-model objects. |
| MySQL migrations | A failure after DDL begins can leave part of a migration applied because MySQL commits DDL implicitly. |
| MySQL schema bootstrap | `ensureCreated()` and `createScript()` may include unguarded index DDL. Treat them as one-time creation plans, not repeatable reconciliation. |
| Platform surface | Node.js only. Native ESM output for NestJS does not broaden the runtime boundary. Browser, Edge, alternative-runtime and general bundler support remain unqualified. |

The executable sources for these claims are the [CI matrix](../.github/workflows/ci.yml),
[package acceptance test](../scripts/check-package.js), and
[architecture tests](../tests/architecture/). Security-sensitive boundaries are
documented in the [security policy](../SECURITY.md).

## Stable compatibility policy

This policy applies when the first stable family is published. Current
source versions are `0.1.0-alpha.3`; preparing a stable workflow does not convert an
alpha into a stable release. The first stable version has not been selected.

A stable compatibility line is one major version for `1.x` and later, or one
minor version for `0.x`. Within that line, preserve public exports, declaration
signatures and documented runtime behavior. Compatible additions and fixes
require reviewed API reports and consumer acceptance. A breaking change needs
a new compatibility line and explicit upgrade notes. The experimental entry
remains outside this guarantee; internal files and undeclared deep imports
remain private.

The versioned [API reports](api/README.md) cover ten public entry points and
all seven export maps. `check:api` refuses changes without explicit review.
The migration-version constant changes with release metadata and is reviewed
separately from signature changes. Every package in a release peers on the
same exact core; applications must upgrade the family together.

Persisted migration contracts include applied checksums, historical SQL,
history rows and versioned model snapshot formats. Changing the SDK version
must not rewrite an applied migration or silently reinterpret its snapshot.
The [published-release upgrade campaign](migration-compatibility.md) installs
the actual previous SDK, seeds databases and checks forward migration,
rollback, existing data and checksum-drift refusal on all three providers.
A future persisted-format change needs an explicit versioned transition and
new compatibility evidence.

The first stable family retains the declared Node, provider and module
qualification matrix above. Stable publication does not broaden support to a
different Node major, database major, operating system or bundler. Server
patches exercised locally are recorded in [the hardening evidence](hardening.md);
required CI lanes use Postgres 18 and MySQL 8.4. Custom providers own their
qualification. Operational and performance budgets are documented in
[provider qualification](provider-qualification.md) and
[the benchmark guide](../benchmarks/README.md).

Security maintenance follows [the support policy](../SECURITY.md#supported-versions).
Use [the upgrade procedure](upgrading.md) for application deployment and
[the release guide](releasing.md) for exact-source and accepted-artifact proof.
