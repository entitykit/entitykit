# Performance contracts and model reuse

The [executable qualification](../benchmarks/README.md) combines deterministic
work counts with larger populated SQL workloads. Timing reports identify their
runtime, server, Git revision, dirty state, storage and sample sizes. Portable
smoke budgets catch regressions; application latency and capacity need the
application's data, queries, network and production host.

## Contracts repaired in the performance pass

Inverse reference includes group changes by principal and navigation. Each
group owns a working collection and membership index, then publishes once with
one journal write and baseline refresh. Per-child references still use verified
writes, and refused accessors, pending intent, supersession and failed loads
retain their rollback guarantees. Collection stitching uses Set membership.
Before the first reference write, includes inspect the participating reference
and inverse navigations. Bidirectional setters and dynamic collections retain
immediate fixup, so their own inverse edits remain valid.

Ordinary change detection batches inverse collections once per principal and
navigation in each of its reference and inverse-intent passes. The second pass
still observes the completed first pass before resolving user intent. Membership
indexes also bound duplicate work. Dynamic graphs and Added relationship owners
retain immediate fixup. The outer detection journal owns rollback. A no-op save
still restores its temporary plan changes; explicit `detectChanges()` retains
the graph and advances its baseline.

Composite include predicates preserve binding order in a balanced tree. Batches
have at most 256 composite tuples and respect the provider's actual parameter
limit, including applied filters, tenant bindings and window bounds. Windowed
scalar collections and many-to-many batches partition disjoint parent-key sets
so each parent's complete window stays together. Unsupported window batching
retains the existing per-parent path.
Include filters capture owned provider operands once per load. The parameter
probe and key chunks reuse those facts while binding independent value copies;
null membership, string patterns, tenant scope and parameter order are preserved.

SQLite streams yield after at most `min(batchSize, 256)` rows and check
cancellation before continuing. Fast consumers can receive timers and heartbeats;
one long synchronous native step remains non-preemptible. PostgreSQL stops
fetching after a short batch, while exact full batches still need an EOF fetch.
Cancellation is checked after the last yielded row before successful completion,
including a short final batch in an owned or caller transaction.

Tracking consumes its already-owned prepared initial snapshot once. Buffered
no-tracking materialization uses query-local identities instead of full tracked
entries and original-value snapshots, including identity sharing in include
graphs. Persistence facts remain available for later attachment/concurrency
operations. Attaching takes the current entity values as its tracking baseline.

Generated-value lookup is indexed by tracked entry and property while retaining
ordered records, latest-value semantics, cloned values and lifecycle clearing.
Persisted snapshots are indexed once per merge. Bulk deletion acceptance
updates each entry's indexes and validates the completed boundary once; public
detach still validates immediately. Checkpoints, reserved identities, failed
acceptance and caller-transaction rollback remain covered.

Cascade discovery for ordinary data properties resolves affected
principal/dependent adjacency through the existing captured key, tenant and
pending-intent rules, then processes a queue.
It rechecks live relationship intent before applying each edge and preserves
the dependent-state boundary between principals. The linear work gate covers
relationship resolution for disjoint pairs and reverse-tracked chains. Ordinary
Cascade and SetNull paths also accumulate inverse removals by principal and
navigation, then publish each completed collection once. Their public tests
bound collection work as child counts increase and verify failure restoration
and caller rollback. Loaded-removal benchmarks exercise both behaviors on all
three providers. No constant-cost claim applies to dynamic application hooks.
Graphs with relationship/FK accessors, entity/prototype proxies, proxied inverse
arrays or custom collection descriptors retain ordered
live discovery: arbitrary user code can redirect another dependent during a
cascade, which invalidates a precomputed edge index. Descriptor inspection
selects that path without invoking getters or proxy traps.
Post-save-only observers no longer rebuild the pre-save plan. An actual
`savingChanges` callback still does, because it may change tracked state.

Normal SDK builds preserve TypeScript incremental state. `build:clean`,
prepack and package acceptance remove stale outputs explicitly. Verification
accepts one clean package-family build, then checks its outputs rather than
compiling the same seven projects repeatedly.
Normal builds derive expected outputs from each TypeScript configuration and
invalidate that package's incremental state when runtime or declaration files
are missing. This includes internal modules and the CLI entry point.

## Model-reuse decision

Keep per-context model construction in this pass. Introduce model reuse in a
separate prerelease API change through an **explicit compiled-model handle**,
with caller-owned model identity and provider compatibility. Constructor-only
caching is unsuitable: `model()` may use instance configuration, schemas,
converters or callbacks that capture application state. A shared data source
currently shares provider resources, not a finalized model.

The current metadata's TypeScript `readonly` members do not establish deep
runtime immutability. `EntityMetadata` retains supplied property, relationship
and index arrays, and converters/materializers can retain mutable closures.
Reusing these objects silently would change existing ownership semantics.
A model snapshot alone cannot reconstruct constructor and callback identities.

A future opt-in contract must establish all of these before it skips `model()`:

- Finalization copies and owns metadata, nested arrays and mutable default
  values; lookup maps expose no mutators. Builder changes cannot affect a handle.
- Separate mapping variants get separate explicit handles. Provider-specific
  column/index validation, including physical identifier rules, runs before SQL.
- Shared converters and factories are explicitly safe to reuse; freezing a
  function object cannot freeze its captured state. Factories still create fresh
  entities and preserve converted identity and attachment behavior.
- Every context still configures fresh tenant callbacks, clocks, interceptors,
  trackers, operation guards and connection ownership. A model handle carries
  no request state and does not bypass tenant-scope validation.
- Tests exercise two contexts with distinct instance mappings, independent
  options/tenants, retained builders, mutable defaults, failed initialization,
  incompatible providers and context disposal. Benchmarks report model setup
  separately from warm queries and prove the hook is skipped only by opt-in.

This is a design direction, not an API available in the current release. The
four setup workloads quantify the current cost without introducing a hidden
cache or a constructor identity rule.

## Provider follow-ups

SQLite data sources can explicitly retain a bounded number of idle native handles
with `maxIdleConnections`. Reuse removes repeated file opens and connection
configuration while each context retains its own exclusive lease and ORM state.
The default remains zero. Only filesystem paths are supported; session-changing
SQL and failed provider operations retire the leased handle instead of attempting
to reset unknown session state. This is separate from prepared-statement caching.

SQLite statement classification first checks for a semicolon. SQL without one
requires no quote/comment scan; statements containing one use the existing
scanner and script/parameter rules. No statement is cached by this shortcut.

Keep SQLite statement reuse as a measured follow-up: a connection-owned cache
needs a strict bound, active-iterator ownership, schema-change invalidation and
disposal coverage. Its microsecond-scale benefit should be assessed after graph
and snapshot costs on a controlled host.

The stream matrix records PostgreSQL's real cursor commands at batch sizes 32
and 256. Use representative network latency and payloads before changing the
default or cursor design. SQL text caching remains bounded and unchanged.

## Operation-scope lifetime

Exclusive connection guards share one async-local store and retain separate
tokens for each owning operation. A linked scope chain preserves access to
outer transactions through nested guards, while overlapping queries, unrelated
async chains and expired operation tokens remain rejected. Ending one guard
does not disable another guard's store or the application's async context.
Detached continuations skip expired parent scopes when starting new work.

This bounds Node 22's enabled async-hook registrations and Node 24's copied
async-context frame keys. A store per short-lived guard can leave keys in the
caller's restored Node 24 frame even after the guard disables its own current
frame. Repeated context construction then increases the cost of later async
operations. The resource regression checks the number of distinct async-local
stores across 256 guards, alongside nested ownership and detached-continuation
coverage. Per-context model construction and connection ownership are unchanged.

## Required-column ordering

Single-table ordering uses the mapped column's nullability. Required columns
map to `NOT NULL` and need no extra provider terms to place nulls first or last;
removing those terms can let a composite index satisfy the complete ordering.
Nullable columns retain portable null placement. Joined and aggregate values
keep their existing null handling because joins and expressions can introduce
nulls even when the source column is required. Compiled SQL cache keys include
ordered-column nullability so different mappings cannot share the wrong text.

## Snapshot allocation

Scalar snapshot cloning returns the original immutable value before allocating
cycle-tracking state. Snapshot equality likewise allocates that state only when
comparing structured graphs, after primitive, date, regular-expression and binary
comparisons. Recursive comparisons share one visited-pair map; structured clones
retain their existing cycle, aliasing and isolation behavior.

## Empty tracker allocation

Trackers defer their registry until tracking, identity lookup, acceptance or
relationship detection requires it. Empty entry checks, enumeration, detach and
clear avoid allocating registry maps and callbacks. Mutation guards still run
before detach and clear; identity lookups still normalize and validate keys.
Configured relationship detection initializes registry ownership even when its
entry list is empty, so restoration journals retain their normal guarantees.

Each tracker owns its registry once initialized. Clearing tracked entities
retains that registry for acceptance and relationship journals, and observer
callbacks continue to use the tracker's current observer slots. Read-only query
trackers can remain uninitialized throughout their lifetime.

Save mutation guards also defer reservation maps. Deferred save acceptance
initializes its entity and identity maps; upsert input reservation initializes
its separate entity map. Read-only guards need neither. Once initialized, maps
remain owned by that guard and are reused across releases. Nested reservation
counts, idempotent release, usability checks and save-execution checks retain
the same behavior.

## DbSet service adapters

Each DbSet retains its own service adapter and captured method references.
Accessor implementations are shared on a private class prototype; options,
database and model callbacks remain live and lazy. This avoids five accessor
closures per set without sharing a context, tracker, model or tenant state.

## Materialized ancestor checks

Mapped-property writes inspect complex ancestors with an indexed loop instead
of allocating a callback for every property, including flat models. Each check
reads the current metadata array, captures its initial length, skips absent
indices and stops at the first matching null ancestor. Inherited indices and
mutations to existing indices remain visible; no metadata is cached across
properties or queries.

## Materialized write diagnostics

Successful mapped writes defer joining the entity and property names until a
provider comparison or a refused assignment needs the diagnostic context. The
names are still read and coerced before the live value lookup, preserving getter
order and the original names when a value getter or setter changes metadata.
Restoration writes retain their eagerly composed context and journal behavior.

## Property write targets

Mapped writes traverse directly to the target object without constructing a
short-lived target/name pair. Callers that request a target/name pair still get
one. Both paths capture and validate the leaf first, then call the path's slice
method and traverse its iterator before assigning the value. Custom path methods,
inherited setters and created-but-replaced ancestor objects retain their behavior.

## Provider capture diagnostic experiment

The capture diagnostic-string shortcut was reverted after qualification: temporary
hydration allocation did not decrease and HTTP read differences stayed small
with overlapping ranges. Capture retains eager context formatting. Regression
coverage for metadata/coercion order, converter diagnostics, null bypass and
bound JSON round trips remains.

## Save executor allocation

A context creates its save executor only after a nonempty save plan and the
cancellation/disposal checks. Reads, plan previews and empty saves do not allocate
the executor or its lifecycle/tracked-state helpers. Once created, the same
executor stays owned by that context across successful and failed saves and
tracking clears. Transaction ownership and live option/interceptor reads remain
per context; there is no shared executor cache.
