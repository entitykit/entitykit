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

The SDK and gate checkpoint is `eea6ccbc66f4d53b6bd044822c247b31b9877427`.
Final documentation follows that checkpoint without changing SDK source.
Local campaigns use Node 22.13.0 and Node 24.19.0 on macOS ARM64, Postgres
18.4 on an isolated loopback port, MySQL 8.4.11 in an isolated Docker service,
and temporary SQLite files. Hosted release lanes use `ubuntu-latest` and must
pass on the exact reconciled release SHA before publication.

| Gate | Local evidence |
| --- | --- |
| Canonical verification | Lint, live scoped security audit, strict types, 500 suites / 3,114 tests, production examples, public contracts, historical upgrade, operations, performance, accepted packages and publication dry runs |
| Public contracts | Ten signature reports and seven package export maps; negative tests for fields, generic constraints, constructors and overloads |
| Package acceptance | Seven actual tarballs; CommonJS/ESM runtimes, Node16/NodeNext types, one core instance, CLI, peer-skew refusal, and an external packed Bookshop SQLite consumer |
| Runtime coverage | 757 executable source files; 95.04% statements/lines, 90.47% branches, 94.81% functions; all existing floors pass |
| Critical mutation | 93.03% across the declared critical seams; fresh baseline plus incremental reruns after ownership regressions; unchanged source and responsible tests are the only reused results |
| Migration mutation | 95.77% on history initialization, lock ownership and transaction boundaries; no untested mutants |
| Canonical live providers | Postgres: 25 suites / 129 tests; MySQL: 16 suites / 94 tests; both Node runtimes pass |
| Performance/resources | Thirteen workloads per provider on both runtimes; latency, query/parameter counts, pool pressure, streaming, retained heap/RSS and event-loop budgets pass |
| Framework example | Next.js 16.3.8 production build, migration check/dry run/application/status, and both real Chromium flows against Postgres |

The complete canonical gate is `npm run verify`. CI also requires runtime
coverage, both mutation campaigns, both provider lanes on both runtimes, and
the Next.js browser lane. [Contributing](../CONTRIBUTING.md) lists the commands.
Coverage uses two workers that recycle between suites at 512 MiB so V8
debugger state does not accumulate across the entire suite in one process.
The final complete coverage run took 140 seconds; its inventory and floors
were preserved.

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

Reports under `coverage/qualification/performance-node22/` and
`coverage/qualification/performance-node24/` record all six clean checkpoint
combinations, source SHA, runtime/machine, percentiles, statement/parameter
counts and resource metrics. Accepted artifacts and local qualification receipts
are retained under `coverage/qualification/`. These generated receipts are not
checked into source; CI uploads the required performance artifacts.

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
