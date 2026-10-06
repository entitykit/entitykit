# Stable behavior and qualification

The alpha.3 corrective pass has a finite scope: safe aggregate result fields,
validated counts, PostgreSQL savepoint ownership, ordinary cascade inverse
removals, and both released upgrade baselines. After its release, stabilization
keeps the public behavior below fixed while qualifying combinations and repeated
operations. Model reuse, statement caching, cursor redesign and wider platform
support remain separate proposals.

## Numeric results and aliases

`count()` returns a nonnegative safe JavaScript integer. Aggregate, grouped and
joined counts use the same conversion and reject unsafe, negative, fractional
or malformed provider results. Null or absent aggregate count fields normalize
to zero. Terminal `countBigInt()` preserves exact larger integer counts; it is
not available inside aggregate selectors. Exact grouped counts can use reviewed
raw SQL and explicit result handling.

`sum()` and `avg()` return JavaScript numbers and may round exact database
numeric values. Use raw SQL and the provider's exact representation when that
rounding is unacceptable. This approximate contract is separate from safe counts.

Provider-returned projection, aggregate and group-key aliases become enumerable own fields on
ordinary plain objects. Computed aliases such as `['__proto__']` do not replace
the result prototype. `constructor`, `toString` and ordinary aliases follow the
same property-definition behavior.
The MySQL `mysql2` driver refuses private-property field names such as
`__proto__` before materialization; that existing provider error remains visible.
The core mapper introduces no alias blacklist and preserves aliases returned by
SQLite and PostgreSQL safely.

## Tracking and writes

Buffered no-tracking reads resolve shared identities within the query graph,
without registering entries in the context's change tracker. Later attachment
still uses the recorded persistence facts. A no-op save restores temporary
planning fixup; explicit `detectChanges()` retains its graph and advances the
navigation baseline. These are deliberate differences between those operations.

Ordinary relationship graphs can batch inverse collection edits. Accessors,
proxies, custom collections and Added ownership paths retain immediate behavior
where application code or detachment can invalidate a staged graph. Failed
planning and caller rollback must restore the tracked graph as well as database
state, while preserving the documented pending user intent.

Set-based `executeUpdate()` and `executeDelete()` retain their documented
tenant and soft-delete filters and bypass tracked-save interceptors, audit and
version increments, and outbox processing. Previously tracked objects keep
their existing values. Raw SQL, direct connection access and explicit tenant
bypasses are separate escape hatches; none establishes application authorization.

## Failure ownership

A recovered nested PostgreSQL scope rolls back to and releases its owned
savepoint, including cancellation immediately after creation. Cleanup failure
preserves the original error and prevents an unsafe outer commit. An enclosing
savepoint can recover a deeper failure only after its own cleanup succeeds.

Unknown commit outcomes remain distinct from safely rolled-back failures.
Automatic retry refuses unknown outcomes even with an application classifier.
Durable command receipts and receiver deduplication provide application recovery;
the SDK must not silently repeat a transaction whose outcome is unknown.

## Finite stabilization evidence

The public SQLite repetition tests run three seeded, 36-operation sequences
mixing reference and foreign-key edits, inverse collection edits, detach/reattach,
failed nested saves, recovery and no-op saves. Each step checks stored rows,
optimistic versions, tracker membership and the complete navigation graph against
an independent expected state.

Fifty contexts over one application-owned source alternate stream completion,
early return and cancellation. Each checks a healthy subsequent query, no retained
tracked entries and exactly one current connection lease. Final source disposal
checks that closed contexts left no outstanding leases. PostgreSQL separately
repeats twenty caught failures in one live outer transaction and verifies each
owned savepoint is absent before continuing. These deterministic checks establish
ownership and state transitions, rather than a heap-size or production-latency claim.

The [compatibility matrix](compatibility.md) remains the support boundary. Before
the release, require fresh qualification on the exact candidate: Node 22.13/24,
coverage, every mutation campaign, live PostgreSQL/MySQL, historical alpha.1/alpha.2
upgrades, browser flow, operational/performance checks and seven accepted
tarballs. The existing [release workflow](../.github/workflows/release.yml) runs
that matrix again on the final `main` revision before publishing its accepted
artifacts. Stable version selection and any expanded support claim need their
own explicit decision.
