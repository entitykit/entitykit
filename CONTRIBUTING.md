# Contributing

EntityKit is an alpha ORM with a deliberately small compatibility surface.
Keep each change narrow enough to review as one behavioral or architectural
decision.

## Set up

Use Node.js 22.13 or newer and npm from that Node installation.

```console
npm ci
npm run verify
```

`npm run verify` runs lint, scoped dependency audits, strict types, the
non-server Jest suite, Next.js and Bookshop checks, public contract and historical
migration checks, SQLite operational and performance qualification, the
seven-package tarball acceptance test, and channel-aware publish dry runs. The package
test builds the workspaces, installs the tarballs into a clean consumer, checks
Node16 and NodeNext types, exercises CommonJS and ESM runtimes against SQLite,
runs the installed CLI, and verifies the single-core package invariant.

CI also runs:

```console
npm run test:coverage
npm run test:mutation
```

Coverage uses two workers that recycle between suites at 512 MiB to bound V8
debugger state on the minimum Node runtime. The full runtime inventory and
coverage floors remain defined in `config/coverage.json`.
The coverage command gives Jest's coordinator a 6 GiB heap budget to combine
the complete inventory without changing worker recycling or coverage floors.

The mutation lane is intentionally focused on release-critical restoration,
migration, CLI, provider-value, cancellation and resource-lifetime seams. Run the relevant expensive gate
locally when changing the behavior it protects.
All Stryker campaign definitions live in `config/stryker/`; the npm commands
select their configuration explicitly from the repository root.
`test:mutation` includes separate history-initialization/migration-lock,
provider-validation, SQLite DDL, migration checksum, property metadata, snapshot rename,
SQLite rebuild, SQLite rebuild planning, schema DDL, join-table planning, primary-key order, migration warnings, and existing-key changes
campaigns with the same score thresholds. Run
`npm run test:mutation:migrations` for the focused ownership check or
`npm run test:mutation:provider-validation` for configuration validation before
resource allocation, or `npm run test:mutation:sqlite-ddl` for schema extraction
across SQL quoting, comments, column facets, checks, and index predicates. Run
`npm run test:mutation:checksum` for stable migration identity across SQL binding
types, structured values, unsupported or cyclic input, and static format constants.
Run `npm run test:mutation:property-metadata` for column facets and invalid
combinations of defaults, computed expressions, store generation, and versions.
Run `npm run test:mutation:snapshot-rename` for mapped-property references in
keys, indexes, relationships, and policy roles, including older snapshot formats.
Run `npm run test:mutation:sqlite-rebuild` for transactional migration execution,
foreign-key preservation, cancellation, and constraint-setting cleanup.
Run `npm run test:mutation:sqlite-planning` for dependent rebuild detection,
physical column copying, and grouping of constraints and indexes during schema changes.
Run `npm run test:mutation:schema-ddl` for schema namespaces, provider rendering
callbacks, and SQLite's implicit `main` schema.
Run `npm run test:mutation:sqlite-joins` for retained associations, explicit join
replacement, principal renames, and restoration of original references.
Run `npm run test:mutation:primary-key-order` for declared tuple order,
legacy metadata, and invalid primary-key ordinals.
Run `npm run test:mutation:migration-warnings` for reviewed warning metadata,
explicit rename intent, malformed declarations, and legacy snapshot fallback.
Run `npm run test:mutation:primary-key-change` for existing-key order refusal,
physical tuple identity, legacy metadata, and retained SQLite key transitions.
Run `npm run test:mutation:postgres-generation` for identity options, exact
sequence identifiers and catalog default-expression boundaries.
Run `npm run test:mutation:store-generation` for identity policy, safe integers,
cache sizes, sequence references, numeric bounds and property generation state.
Run `npm run test:mutation:mysql-types` for exact ENUM and SET literals,
provider type translation and deterministic schema-introspection metadata.
Run `npm run test:mutation:operation-signal` for capability and receiver
preservation, forwarded options, combined cancellation and transaction state.
Run `npm run test:mutation:json-validation` for synchronous JSON normalization,
descriptor inspection, exact diagnostic paths and rejected-promise ownership.
Run `npm run test:mutation:postgres-schema-values` for numeric precision and signed
scale, array aliases, catalog booleans, index keys and sequence facets.
Run `npm run test:mutation:mixed-index` for ordered property/expression keys,
builder validation and faithful index generation, including alternate keys,
included properties and skipped metadata diagnostics.
Run `npm run test:mutation:query-plan` for the versioned query-plan contract,
legacy defaults, zero paging, join identity, scope flags and private values.
Their separate scores preserve the original critical
campaign's scope and comparison.

Live provider work needs the matching database lane:

```console
DATABASE_URL=postgres://... npm run test:integration
MYSQL_URL=mysql://... npm run test:integration:mysql
```

CI qualifies Postgres 18 and MySQL 8.4. SQLite tests use Node's built-in
`node:sqlite` and require no external service.

## Architecture contract

Read [the architecture guide](docs/architecture.md) before moving code across
packages or layers. In particular:

- core owns ORM semantics and must stay free of static provider and driver
  dependencies;
- providers, CLI, and testing reach core only through declared package entry
  points;
- no relative import may escape its package;
- model and migration layers keep their tested inward dependency direction;
- compatibility facades are re-export-only and are not internal shortcuts;
- the seven-package runtime graph remains acyclic;
- source modules use focused kebab-case names and stay within the executable
  size budgets.

Do not add function-source parsing, hidden query behavior, or a second ORM/query
builder behind EntityKit's public API. Queries use expression objects, values
stay parameterized, and relationship loading stays explicit unless a caller
opts into the documented lazy-loading feature.

## Tests

Every behavior change needs evidence at the narrowest useful boundary:

- unit tests for model, query, tracking, SQL, and lifecycle behavior;
- SQLite tests for real execution without an external service;
- the shared provider contract plus provider-specific tests for adapter work;
- live Postgres or MySQL integration coverage for database-owned behavior;
- type assertions for public generic or overload changes;
- architecture tests for a new ownership rule or dependency seam;
- package-consumer coverage for exports, module loading, declarations, CLI, or
  dependency-graph changes.

Failure paths are part of the feature. Changes to saving, transactions,
materialization, relationship fix-up, generated values, cancellation, or file
generation should prove both the primary failure and the state left behind.
Prefer an adversarial regression test over a broad happy-path assertion.

Do not weaken a release, architecture, coverage, or mutation gate to make an
unrelated patch pass. Explain a deliberate gate change in the pull request.

## Documentation

Update the public document that owns the changed contract:

- [README](README.md) for the primary user journey and headline limitations;
- [usage](USAGE.md) for task-oriented examples;
- [API](API.md) for public names and signatures;
- [migrations](docs/migrations.md) for CLI and deployment behavior;
- [compatibility](docs/compatibility.md) for runtime, module, provider, or alpha
  support changes;
- [architecture](docs/architecture.md) for ownership and flow changes;
- the relevant package README for package-local installation or usage.

Examples must use published package specifiers, not repository-relative source
paths. State limitations directly and distinguish release-qualified behavior
from behavior that merely works in one local environment.

## Pull requests and commits

A pull request should state:

1. the contract or failure being changed;
2. the owning package and layer;
3. the tests that prove the success and failure paths;
4. any compatibility, migration, provider, or security effect.

Keep generated output and dependency changes in the patch that requires them.
Do not publish packages or move npm tags from a pull request; publication
is a manual, protected workflow from `main`.

Commit subjects use a one-line [Conventional Commit](https://www.conventionalcommits.org/)
with no body and no coauthor trailer, for example:

```text
fix(query): preserve tenant scope in grouped projections
```

Maintainer-integrated history is OpenPGP-signed as
`zsumz <shawn@zsumz.com>`. Contributors should not impersonate that identity;
the pull request remains the authorship record.

Report suspected vulnerabilities privately through the process in
[SECURITY.md](SECURITY.md), not in a public issue.
