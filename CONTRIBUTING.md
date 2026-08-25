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

`npm run verify` runs lint, strict typechecking, the non-server Jest suite, the
six-package tarball acceptance test, and the alpha-publish guards. The package
test builds the workspaces, installs the tarballs into a clean consumer, checks
Node16 and NodeNext types, exercises CommonJS and ESM runtimes against SQLite,
runs the installed CLI, and verifies the single-core package invariant.

CI also runs:

```console
npm run test:coverage
npm run test:mutation
```

The mutation lane is intentionally focused on release-critical restoration,
migration, CLI, and provider-value seams. Run the relevant expensive gate
locally when changing the behavior it protects.

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
- the six-package runtime graph remains acyclic;
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
Do not publish packages or move npm tags from a pull request; alpha publication
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
