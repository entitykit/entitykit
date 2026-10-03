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
| Operation cancellation | Rejected promises stay observed; real single-connection pools reclaim 96 canceled queued operations per remote provider; active query cancellation, preaborted operations, stream exit and bounded strict-process shutdown pass on all three providers | Client disconnect and lost acknowledgment campaigns |
| Dependencies | Compatible security fixes; runtime scopes have zero known advisories; unreviewed tooling findings fail | Re-review the expiring `braces` tooling exception when patched |
| Public contracts | Versioned signatures and package exports; negative compatibility tests; published alpha.1 checksum/SQL/snapshot fixtures and actual persisted-data upgrade/rollback on all three providers | Final candidate qualification |
| Bookshop adoption substitute | Atomic inventory/version/order/audit/outbox/receipt; replay, tenancy, rollback, concurrent checkout; durable receiver deduplication and actual application process crash recovery on all three providers; standalone accepted-tarball SQLite consumer | Final release campaign |
| Operational recovery | Canonical Postgres and MySQL integration suites; Bookshop process crash drills | Lost commit acknowledgment, deadlock/disconnect recovery, provider-specific migration crash/repair drills |
| Performance/resources | Benchmark evidence validation | Executable representative workloads, direct-driver comparison, latency/query-count/memory/stream/pool budgets |
| Release preparation | Seven-package tarball integrity and provenance workflow; alpha publication guards | Stable candidate/latest mechanics, stable support and upgrade policy, complete final qualification |

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
