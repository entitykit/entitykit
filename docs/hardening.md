# Stable release hardening

The authorized repository hardening is implemented on `hardening`, in small
PGP-signed, bodyless Conventional Commits by `zsumz`. EntityKit versions remain
`0.1.0-alpha.2`. The local qualification covers SQLite, Postgres and MySQL;
stable version selection and publication remain separate release actions.

The Pagerbase adoption step is replaced by the repository-owned
[Bookshop example](../examples/bookshop/README.md). It exercises a non-on-call,
tenant-scoped checkout and fulfillment application through public packages.
Pagerbase itself has not been modified.

## Qualification

The current coverage and Node 24 canonical checkpoint is
`823c214e1fc4e0b9c0f852b21f6bde6d2051eaa8`. Node 22 canonical verification
also passes at the SQLite SDK checkpoint `6ffcae84093c93ed3d7e874748ca084e11b595a7`;
the subsequent changes add tests, fixtures and mutation campaigns.
The earlier shared-core and live-provider checkpoint is
`49e2a5d402e51d28838db90254a7403bd588bd9c`. SDK changes since it are confined
to SQLite schema extraction and are qualified through real SQLite round trips.
Local campaigns use Node 22.13.0 and Node 24.19.0 on macOS ARM64, Postgres
18.4 on an isolated loopback port, MySQL 8.4.11 in an isolated Docker service,
and temporary SQLite files. Hosted release lanes use `ubuntu-latest` and must
pass on the exact reconciled release SHA before publication.

| Gate | Local evidence |
| --- | --- |
| Canonical verification | Lint, live scoped security audit, strict types, 510 suites / 3,402 tests in the latest Node 24 gate and Node 22 coverage run; production examples, public contracts, historical upgrade, operations, performance, accepted packages and publication dry runs |
| Public contracts | Ten signature reports and seven package export maps; negative tests for fields, generic constraints, constructors and overloads |
| Package acceptance | Seven actual tarballs; CommonJS/ESM runtimes, Node16/NodeNext types, one core instance, CLI, peer-skew refusal, and an external packed Bookshop SQLite consumer |
| Runtime coverage | 759 executable source files; 95.38% statements/lines, 91.41% branches, 94.84% functions; all existing floors pass |
| Critical mutation | 95.76% across the original 57-file / 1,401-mutant scope; 95.72% when holding the original scored denominator constant; fresh baseline plus incremental qualification |
| Migration mutation | 98.59% on history initialization, lock ownership and transaction boundaries; no untested mutants |
| Provider validation mutation | 99.27% in a separate campaign for configuration validation before resource allocation; no untested mutants |
| SQLite DDL mutation | 90.57% in a separate four-file / 488-mutant campaign covering schema extraction across quoting, comments and expression boundaries |
| Checksum mutation | 100% across all 120 serializer mutants, including static format constants; 14 fixed digests match the published alpha.1 package |
| Property metadata mutation | 100% across all 104 finalizer mutants; public builder refusals and valid sparse metadata defaults; no untested mutants, errors or timeouts |
| Canonical live providers | Postgres: 25 suites / 129 tests; MySQL: 16 suites / 94 tests; both Node runtimes pass |
| Performance/resources | Thirteen workloads per provider on both runtimes; latency, query/parameter counts, pool pressure, streaming, retained heap/RSS and event-loop budgets pass |
| Framework example | Next.js 16.3.8 production build, migration check/dry run/application/status, and both real Chromium flows against Postgres |

The complete canonical gate is `npm run verify`. CI also requires runtime
coverage, all six mutation campaigns, both provider lanes on both runtimes, and
the Next.js browser lane. [Contributing](../CONTRIBUTING.md) lists the commands.
Coverage uses two workers that recycle between suites at 512 MiB so V8
debugger state does not accumulate across the entire suite in one process.
The current complete coverage run took 139 seconds; its inventory rules and floors
were preserved.

The preceding coverage follow-up added 118 tests for malformed rename options, identity
collisions and cyclic keys, exact rollback pre-images, map keys, bounded
diagnostics, migration refusal guidance and provider configuration. Compared
with the preceding qualification, line coverage increases from 95.04% to
95.21%, branches from 90.47% to 90.94%, critical mutation from 93.03% to
95.21%, and migration mutation from 95.77% to 98.59%. The original mutation
scope and thresholds remain unchanged. Equivalent defensive mutants remain in
the denominator.

These tests exposed a malformed value reader accepted by `useDataSource` but
rejected by `useProvider`. Both now reject malformed readers before allocating
a connection, while accepting structurally valid object and callable readers.
The separate provider-validation mutation campaign is part of the required
CI mutation command. Its score does not change the original campaign's scope.

The continuing follow-up adds 170 tests for SQLite lexical and expression
boundaries, queued relationship ownership, tenant setter diagnostics, published
migration identities and property generation rules. Compared with the preceding
checkpoint, line coverage increases from 95.21% to 95.38% and branches from
90.94% to 91.41%. The new checksum and property metadata campaigns both reach
100% branch coverage and mutation scores without lowering thresholds.

Seven surviving critical mutants are now killed. Immediate observation of
failing navigation-load promises also converts 14 mutation-runner errors into
ordinary killed mutants. The raw scope remains 1,401 mutants; Stryker's scored
denominator grows from 1,378 to 1,392. Holding the original scored denominator
constant yields 95.72%, compared with 95.21%. Unchanged source and responsible
tests are the only reused results, and equivalent defensive mutants remain in
the denominator.

The SQLite regressions repair quoted-name and comment scanning, prevent
expression-internal collation from becoming column collation, and preserve
parenthesized defaults through schema extraction, code generation and execution.
The separate DDL campaign starts at 65.49% for 455 mutants, reaches 90.77% for
that scope, then reaches 90.57% for 488 mutants after the expression repair adds
source. These additions leave the original three mutation scopes unchanged.

The earlier deadlock, lost-acknowledgment and abrupt-server-restart campaigns
remain attributed to `eea6ccbc66f4d53b6bd044822c247b31b9877427`; those failure
and recovery implementations are unchanged by the later repairs. The native
provider suites, provider Bookshop/performance checks and Postgres browser flows
remain attributed to the shared-core checkpoint above. The current Node 24 gate
reruns the canonical SQLite, package and example checks on a clean signed tree.

## Contracts qualified by the example and provider campaigns

Bookshop commits inventory and optimistic version changes, order, audit,
outbox and command receipt atomically. Its receipt fingerprints operation,
tenant, actor and request payload, then replays the original result. The
campaign checks cross-tenant refusal, stale versions, rollback, concurrent
duplicate commands, and concurrent purchase of the last copy on every provider.

Fulfillment sends before acknowledging the outbox. A durable receiver verifies
the order fingerprint and deduplicates the shipment. Separate application
processes exit before checkout commit, after checkout commit, and after the
receiver commits before acknowledgment. Fresh data sources prove rollback,
durable replay, one business effect, and eventual acknowledgment.

Strict bounded provider processes reclaim 96 canceled queued operations behind
a held single-connection pool per remote provider. Preaborted operations, active
server-query cancellation, 20 stream cancellation/early-return cycles and
healthy reuse all pass. SQLite checks cancellation between synchronous native
steps; a currently executing native statement is not preempted. Rejected work
remains observed after cancellation, and late resources are reclaimed.

Real TCP faults drop a COMMIT acknowledgment or disconnect after an uncommitted
write. Checked-out Postgres clients now own asynchronous driver errors, discard
failed clients and hand event ownership back on release. Both providers return
an unknown commit outcome without consulting even a permissive retry policy;
the durable receipt proves one committed checkout. Disconnects before commit
roll back and permit healthy reuse. A real deadlock retries the complete unit
of work: three attempts produce two commits and the expected values.

Migration process drills kill a separate process after real DDL and before
data/history writes. SQLite and Postgres roll back the uncommitted table.
MySQL preserves nontransactional DDL without a history row; the drill inspects
the known empty partial object before explicitly dropping it. A fresh runner
then acquires the lock, applies exactly once and rolls back cleanly. Application
repair requires the inspection described in [the upgrade guide](upgrading.md).

Fresh Postgres migration races exposed history-table creation before advisory
lock acquisition, causing catalog error `23505`. Initialization now happens once
under the provider lock on one session. Repeated runner races and simultaneous
history-reader/update races pass. Default initialization rejects caller-owned
transactions before SQL; explicitly read-only history checks remain available
inside them. This prevents implicit MySQL DDL commits and invalid lock cleanup.

The server drills abruptly restart only verified isolated Postgres/MySQL
instances while one checkout is committed and another is uncommitted. Recovery
preserves the committed inventory/version/order/audit/outbox/receipt, discards
uncommitted state, replays the receipt and accepts a fresh command. Application
process and database server recovery are qualified here. Filesystem, storage
hardware, host power loss and backup restoration belong to deployment testing.

The [historical upgrade campaign](migration-compatibility.md) installs four
actual published `alpha.1` SDK artifacts with pinned integrities. Every provider
preserves old migration checksums, SQL, snapshot format and history, reads and
versions existing application data, applies/rolls back a new migration, and
refuses an altered historical migration body.

## Performance and retained evidence

The [benchmark guide](../benchmarks/README.md) defines the dataset, direct-driver
comparisons and portable budgets. Single-row reads and 64-row saves/upserts use
one application statement; split includes use two, checkout seven and durable
delivery six. Streams retain no tracked entities. Sixty-four disposed context
cycles qualify retained heap after GC. Idle operation guards now disable only
their own async scope, preserving nested and application scopes; this repaired
the minimum-runtime pool-pressure failure without changing its 250-ms budget.

Reports under `coverage/qualification/coverage-improvement/performance-node22/`
and `coverage/qualification/coverage-improvement/performance-node24/` record all six clean checkpoint
combinations, source SHA, runtime/machine, percentiles, statement/parameter
counts and resource metrics. Accepted artifacts and local qualification receipts
are retained under `coverage/qualification/coverage-improvement/`, with the
preceding qualification preserved under `coverage/qualification/`. These generated receipts are not
checked into source; CI uploads the required performance artifacts.

The continuing checkpoints retain source-attributed, SHA-256-checked logs,
coverage inventories, mutation reports and accepted tarballs under
`coverage/qualification/continuous-slices/`. The current Node 24 package receipt
includes all seven accepted bytes and their SHA-512 integrities. CI is configured
to retain runtime coverage and all generated mutation reports, including failed
campaigns.

## Release actions still required

1. Select the coordinated stable package version and its compatibility line,
   then update release notes and manifests when version changes are authorized.
2. Reconcile the reviewed branch with `main` and obtain fresh complete hosted
   CI evidence for that exact source revision and the accepted artifact family.
   Run the live security gate again; a prior audit receipt is insufficient.
3. Configure/review the trusted publisher and dispatch the
   [Release workflow](releasing.md) with the stable-channel confirmation.
   Verify registry integrities, candidate staging, public tag promotion and the
   complete coherent family. Publication and promotion are separate stages.

Executed local release-shell tests already qualify alpha/stable forward
movement, strict-404 bootstrap, authentication/network refusal, conflicting
bytes, same-integrity retry, candidate staging, verification before promotion,
bounded tag retries and convergence after a partially promoted family.
Synthetic stable npm dry runs performed no registry writes.

Runtime dependency scopes have zero known advisories. The sole reviewed tooling
advisory is `braces`, documented in [the security policy](../SECURITY.md#dependency-qualification)
and [the path review](security-tooling-review.json), expiring
`2026-11-02T00:00:00Z`. Unreviewed findings, changed paths and an expired review
fail the gate. Re-review it when patched or before the exception expires.
