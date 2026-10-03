# Stable release hardening

Work is on `hardening`, in small independently verified, PGP-signed commits.
EntityKit versions remain `0.1.0-alpha.2`. Stable publication, tags, remote
pushes, and Pagerbase changes are outside this work's authorization.

The production assessment covers SQLite, Postgres, and MySQL. The Pagerbase
adoption campaign is replaced by the repository-owned
[Bookshop example](../examples/bookshop/README.md), a tenant-scoped bookstore
checkout and fulfillment application using public packages.

| Workstream | Current evidence | Remaining qualification |
| --- | --- | --- |
| Operation cancellation | Rejected promises stay observed; real single-connection pools reclaim 96 canceled queued operations per remote provider; active query cancellation, preaborted operations, stream exit and bounded strict-process shutdown pass; checked-out Postgres clients own asynchronous driver errors | Final candidate qualification |
| Dependencies | Compatible security fixes; runtime scopes have zero known advisories; unreviewed tooling findings fail | Re-review the expiring `braces` tooling exception when patched |
| Public contracts | Versioned signatures and package exports; negative compatibility tests; published alpha.1 checksum/SQL/snapshot fixtures and actual persisted-data upgrade/rollback on all three providers | Final candidate qualification |
| Bookshop adoption substitute | Atomic inventory/version/order/audit/outbox/receipt; replay, tenancy, rollback, concurrent checkout; durable receiver deduplication and actual application process crash recovery on all three providers; standalone accepted-tarball SQLite consumer | Final release campaign |
| Operational recovery | Canonical integration suites; real TCP commit-response loss and pre-commit disconnect recovery; atomic deadlock retries; killed migration process repair; abrupt Postgres and MySQL server restart durability, rollback and receipt replay | Final candidate qualification; storage hardware qualification belongs to deployment |
| Performance/resources | Thirteen executable workloads per provider; direct-driver read comparisons, latency percentiles, constant query/parameter budgets, no-tracking stream bounds, disposed-context heap retention, pool pressure, atomic checkout and durable delivery | Final declared Node matrix and candidate qualification |
| Release preparation | Alpha/stable channel policy and marked dry-run guards; executed workflow shell qualifies stable candidate/latest promotion, exact bytes, forward movement and interrupted-family convergence; stable support and upgrade policy | Complete final qualification; later authorized version selection and publication |

## Local evidence

The cancellation and security slices passed the complete `npm run verify`
gate, including lint, strict types, 487 suites / 2,960 tests, the patched Next.js
production build, seven packed consumers, module-format checks, a single core
instance, CLI acceptance, peer-skew refusal, and publication dry-run guards.
The Bookshop checkout slice passed that gate and its public-package scenarios
on all three providers.

The delivery slice passed the full gate with 2,961 tests. Package acceptance
also compiled the Bookshop sources outside the checkout against the accepted
tarballs and ran the complete SQLite checkout, concurrent receiver, and process
recovery scenarios there.

The API contract slice passed the full gate with 488 suites / 2,977 tests,
all ten public signature reports, and the seven-package export contract.

The historical migration slice passed the same full gate. A separately
installed published `alpha.1` consumer seeded real databases on all three
providers. The candidate preserved its checksum, SQL, snapshot format and
history row; read and versioned existing application data; applied and rolled
back a new migration; and refused an altered historical migration body.
The fixture records the integrity of each historical package artifact.

The operational cancellation gate runs the built public packages in a separate
Node process with strict unhandled rejections and a 30-second exit deadline.
Postgres and MySQL each pass three rounds of 32 queued queries, streams,
transactions and sessions behind a held single-connection pool, without
executing canceled SQL or callbacks. Four canceled server sleep queries each
permit an immediate healthy query. Every provider passes preaborted operations
and 20 stream cancellation/early-return cycles with seven-row batches, followed
by a healthy query and bounded source shutdown. SQLite checks cancellation
between synchronous native steps; it does not promise interruption of a
currently executing native statement.

The lost acknowledgment campaign exposed a fatal asynchronous `pg` client
error after socket loss while checked out. A scoped client lease now owns
driver errors, refuses further SQL on failed clients, removes them from the
pool, and hands event ownership back on release without accumulating listeners.
The real TCP fault now returns an unknown transaction outcome on both remote
providers. A deliberately permissive retry policy is never consulted; replay
through the committed Bookshop receipt proves one complete atomic checkout.
This repair passed the complete gate with 490 suites / 2,990 tests, unchanged
public API reports, package acceptance, and both canonical live suites again
(Postgres 125 tests, MySQL 94 tests).

Both remote providers pass a real two-transaction deadlock: one victim retries
the complete operation, three attempts produce two committed operations, and
both rows contain the expected values. A socket cut after an uncommitted write
rolls it back, discards the failed physical client, and permits a healthy new
operation through the same logical lease.

Migration drills SIGKILL a separate process after real table DDL completes but
before data and history writes. SQLite and Postgres roll back the uncommitted
table. MySQL preserves its nontransactional DDL with no history row; the drill
inspects the known empty partial object before explicitly dropping it. A fresh
runner then reacquires the migration lock, applies exactly once, and rolls back
cleanly on every provider. This is a migration repair qualification, not an
automatic destructive repair policy for application databases.

The server campaign restarts only a verified isolated database instance while
Bookshop has one committed checkout and a second checkout persisted inside an
uncommitted transaction. PostgreSQL immediate shutdown and MySQL SIGKILL both
recover the committed inventory/version/order/audit/outbox/receipt, discard
all uncommitted state, replay the original receipt, and accept a fresh command.
SQLite's embedded engine is covered by the application process crash campaign.
These are database process recovery results; filesystem, storage hardware,
backup restoration and host power loss must be qualified by the deployment.

The executable performance campaign passes thirteen workloads per provider on
Node 22.13 and Node 24. Single-row reads and 64-row saves/upserts each use one
application statement; split includes use two, checkout seven and durable
delivery six. Streams retain no tracked entities. Reports record latency
percentiles, parameter counts, heap/RSS growth, event-loop delay, source SHA and
dirty state with explicit budgets in [the benchmark guide](../benchmarks/README.md).

Profiling the minimum Node runtime found operation guards retaining enabled
async scopes after their work ended. Guards now release their own idle scope
without disabling nested or application authority scopes. The original
250-ms pool-pressure budget passes after this repair; it was not relaxed.
The scope repair and performance gate passed the full canonical gate with
492 suites / 2,999 tests and unchanged API contracts. Both remote operational
campaigns passed again after the repair.

Stable preparation passed the alpha publication acceptance for all seven
unchanged packages and a real npm dry run of a synthetic stable package against
a local registry that receives no writes. Executed release workflow shell
tests qualify both channels: exact family preflight, clean-404 bootstrap,
network/authentication refusal, backward-movement refusal for any sibling,
candidate-only staging, same-integrity retry, conflicting-byte refusal,
all-byte verification before promotion, renewed forward checks, bounded tag
retries and convergence after a mixed partial family. These are local synthetic
release-mechanics tests; no package, tag or release was published.

The patched Next.js 16.3.8 demo passed both Chromium browser scenarios on
Node 22.13 against a separate isolated Postgres database. Its migration check,
dry run, application and status checks also passed. This qualifies the
repository example's production paths; arbitrary Next.js apps and bundlers
remain outside the declared matrix.

Live qualification uses isolated SQLite files, Postgres 18.4 on a private
loopback port, and MySQL 8.4.11 in an isolated Docker service. Canonical remote
suites passed: Postgres 25 suites / 125 tests, MySQL 16 suites / 94 tests. These
are local results for the hardening work. Hosted CI for a final reconciled
candidate SHA remains required before a stable release.

Bookshop process drills deliberately terminate separate Node processes before
checkout commit, after checkout commit, and after the fulfillment receiver
commits before outbox acknowledgment. They verify uncommitted rollback,
durable command replay, one shipment, and eventual acknowledgment after a
fresh application data source starts. They qualify application process
recovery; database server and storage crashes remain separate campaigns.

The sole reviewed tooling advisory is documented in
[the security policy](../SECURITY.md#dependency-qualification) and
[the expiring path review](security-tooling-review.json). Release qualification
must run the live registry gate again; an older audit receipt is insufficient.
