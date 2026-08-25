# Security policy

## Reporting a vulnerability

Email [shawn@zsumz.com](mailto:shawn@zsumz.com) with the subject
`EntityKit security report`. Do not open a public issue, discussion, or pull
request for a suspected vulnerability.

Include:

- the affected EntityKit package and version or commit;
- Node.js, provider, driver, and database versions;
- the smallest practical reproduction;
- the expected security boundary, impact, and any known mitigation.

Do not include live credentials, production data, private connection strings,
or third-party confidential information. The maintainer will acknowledge,
triage, and coordinate remediation as promptly as practical. Please allow a
reasonable remediation and coordinated-disclosure window.

## Supported versions

EntityKit is pre-release software. Until the first alpha is published,
security fixes are made on `main`. After publication, fixes target the newest
published alpha and `main`; older alphas do not receive backports.

| Version | Supported |
| --- | --- |
| `main` | Best effort; security fixes are developed here |
| Latest published `0.1.0-alpha.x` | Yes, after publication |
| Older alpha releases | No |
| Unreleased forks and modified tarballs | No |

The exact runtime and provider qualification is in
[docs/compatibility.md](docs/compatibility.md).

## Scope

This policy covers vulnerabilities in the six `@entitykit/*` packages, their
owned build and release process, and the way EntityKit integrates with its
first-party providers.

Vulnerabilities wholly inside Node.js, npm, Postgres, MySQL, SQLite, `pg`, or
`mysql2` belong to those projects. Report an EntityKit issue privately as well
when its configuration, error handling, generated SQL, or integration turns an
upstream issue into an EntityKit-specific exposure.

## SQL and authorization boundary

EntityKit-generated queries keep values separate from SQL text and bind them
through provider placeholders. Model identifiers are quoted by the provider
dialect. This reduces SQL-injection risk; it does not make arbitrary SQL text
safe.

`database.sql`, `database.execute`, `database.rawSql`, provider `rawSql`
helpers, and `DbSet.fromSqlUnsafe` parameterize template interpolations. The
literal portions of those templates are still caller-owned SQL. Never splice
untrusted identifiers, keywords, clauses, or prebuilt strings into SQL text.
`executeStatement` accepts a caller-built `{ text, values }` statement and
carries the same responsibility.

`fromSqlUnsafe` intentionally bypasses tenant and soft-delete filters and
materializes without tracking by default. Direct connection access bypasses
the ORM entirely. Treat both as privileged escape hatches and enforce the
application's authorization predicate explicitly.

Tenant scope is defense in depth for EntityKit's typed query and write paths;
it is not authentication, database row-level security, or a substitute for
least-privilege credentials. `ignoreTenantScope()`, `allowCrossTenantAccess()`,
raw SQL, and direct connection operations are explicit administrative
bypasses. Keep them out of request paths that have not already established
cross-tenant authority.

The MySQL provider enables `multipleStatements` because schema scripts may
contain more than one statement. This makes trusted SQL text and
least-privilege database credentials especially important for MySQL.

## Diagnostics and errors

Runtime diagnostics redact statement values and error details by default.
Save diagnostics also remove tracked entity objects and keys. Query-plan
diagnostics contain SQL shape but never parameter values. `toDebugSql()`
redacts values unless `includeSensitiveData: true` is requested.

Enabling `includeSensitiveData` exposes query and save parameters and original
errors to the diagnostic handler. These may contain tenant identifiers,
emails, tokens, personal data, or driver details. Enable it only in a controlled
environment, redact before forwarding, and never treat logs as a credential
store. `toSql()`, raw `SqlStatement` values, thrown error causes, and direct
driver errors are not safe logging surfaces merely because formatted debug
output is redacted.

## Provider configuration

Postgres and MySQL TLS, certificate, hostname, timeout, pool, and uncommon
driver options are supplied by the application and passed to `pg` or `mysql2`.
EntityKit validates selected option shapes but does not force TLS, choose a
certificate authority, rotate credentials, or establish database privileges.
Use authenticated TLS appropriate to the deployment and a database role with
only the permissions the application needs.

SQLite opens the filename supplied by the application. Do not derive it from
untrusted input. Protect the database file and backups with operating-system
permissions. Foreign-key enforcement is on by default; disabling it is an
explicit legacy-compatibility choice. Journal mode is constrained before it is
placed into a pragma, but the application still owns durability and filesystem
configuration.

## CLI, generated code, and migrations

The CLI discovers and executes project configuration and migration modules with
the current user's privileges. Run it only in a trusted checkout. Review
generated `db pull` source before executing or committing it, especially the
`TODO` and `Review required:` output for schema EntityKit could not model.

Migration generation is conservative, not an authorization boundary. Inspect
the dry-run SQL, require backups appropriate to the data, and grant
`--allow-data-loss` only after reviewing every destructive forward operation.
Rollback plans can also lose data without that gate. MySQL DDL commits
implicitly and may leave a partially applied migration after failure.

## Release integrity

Alpha publication is manual from `main`. The release workflow runs the complete
CI matrix, packs six tarballs once, accepts those exact files as an external
consumer, publishes absent versions with npm provenance under a candidate tag,
accepts same-integrity existing versions on retry, compares all six registry
integrities, and only then moves the `alpha` tags. A version already present
with different bytes stops the release.
