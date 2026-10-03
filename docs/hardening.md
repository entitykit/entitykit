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
| Operation cancellation | Rejected promises stay observed; queued pool acquisition cancels promptly and releases late resources for queries, streams, transactions, and sessions | Real pool pressure, client disconnects, and strict-process resource checks |
| Dependencies | Compatible security fixes; runtime scopes have zero known advisories; unreviewed tooling findings fail | Re-review the expiring `braces` tooling exception when patched |
| Public contracts | Existing strict type and packaged CommonJS/ESM consumer checks | Versioned API reports, compatibility policy, historical migration/checksum fixtures |
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
