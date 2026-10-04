# Stable release hardening

The authorized repository hardening is implemented on `hardening`, in small
PGP-signed, bodyless Conventional Commits by `zsumz`. EntityKit versions remain
`0.1.0-alpha.2`. The local qualification covers SQLite, Postgres and MySQL;
stable version selection and publication remain separate release actions.

The Pagerbase adoption step is replaced by the repository-owned
[Bookshop example](../examples/bookshop/README.md). It exercises a non-on-call,
tenant-scoped checkout and fulfillment application through public packages.
Pagerbase itself has not been modified.

## Migration qualification

Principal-only SQLite key renames now rebuild dependents whose physical
foreign-key definitions change. Populated primary, alternate and composite
keys preserve their rows and enforcement through application and rollback.
Copy planning also uses physical column identity before mapped property names;
property refactors and name swaps preserve the original values during rebuilds.
Unrelated principal changes, relationship declaration order and view mappings
do not trigger dependent rebuilds.

The independent three-module planning campaign improves from 59.79% across
194 mutants to 94.36% across 195 mutants after the copy repair adds one mutant.
All mutants remain eligible, with no untested mutants or runner errors.
Its 32 added regressions cover real schema application and rollback, generated
source ordering, keys, checks, indexes, defaults and generated columns.
The complete planning modules reach 100% line and branch coverage.

Many-to-many principal key renames now rebuild retained SQLite join tables
without discarding associations or named primary keys. Generated TypeScript
qualifies the same application and rollback paths. Explicit join replacements
run before principal renames and retain original foreign-key definitions for
rollback; independently retained associations preserve their rows.

Migration primary keys now follow their declared tuple order while retaining
the configured physical column layout. This repairs MySQL's refusal to create
composite join references when key order differs from property declaration order.
Legacy aligned keys retain their original SQL and omit unnecessary ordinals.

Reordering the same key columns on an existing table is now refused before
scaffolding or SQL. The typed diagnostic records both physical column orders
and requires reviewed provider SQL. Populated principal rows, references and
history remain unchanged across all providers. Physical renames, property
refactors and existing SQLite key membership changes retain their behavior.
The full new 30-mutant refusal campaign improves from 66.67% to 93.33%, with
100% line and branch coverage. Two redundant mutants remain eligible.

The new complete four-module join campaign scores 90.51% across 137 mutants;
12 surviving mutants and one untested defensive refusal remain eligible.
The same four-module scope initially scored 86.13%. Before rollback ordering
was added, its three-module subset improved from 48.98% to 88.78% across
98 mutants; those are separate denominators. The new complete key-order scope
improves from 51.69% to 98.88% across the same 89 mutants, with one equivalent
survivor. Together these five modules reach 100% line and function coverage
and 98.83% branch coverage. No existing score threshold or scope is reduced.

SQLite models explicitly mapped to `main` or `MAIN` now create and migrate
without schema-creation SQL or invalid qualified foreign-key and index targets.
Real catalogs qualify alternate keys, generated columns, collation, indexes,
reference and many-to-many constraints, table rebuilds and complete rollback.
Unsupported namespaces fail before schema SQL; implicit schemas cannot be dropped.
Query alias qualification remains independent of DDL rendering.

Three optional provider rendering methods preserve default Postgres/MySQL SQL
and allow ordered schema creation statements with the owning dialect as `this`.
The separate full 38-mutant schema campaign improves from 76.32% to 100%,
killing all mutants and reaching 100% branch coverage across its three modules.

The cross-table execution repair preserves rows through restrictive, cascading
and `SET NULL` relationships, including explicit `main` schema names. It
suspends enabled foreign keys before the owned transaction, validates the
result before commit, restores enforcement after failure or cancellation, and
disposes a connection that cannot restore its setting. The independent full
executor/SQLite transaction campaign kills all 151 mutants and reaches 100%
branch coverage. Generated migration statements and checksum serialization
remain unchanged. This follows
[SQLite's rebuild procedure](https://www.sqlite.org/lang_altertable.html#making_other_kinds_of_table_schema_changes).

The property-rename repair separately qualifies metadata references,
dependent-only SQLite renames, and live Postgres/MySQL renames and rollback.
Its full 72-mutant campaign scores 95.83%, retaining equivalent defensive
mutants in the denominator. All eighteen campaigns use the existing thresholds;
the original three scopes are unchanged.

## Qualification

Setters that delete an array element now fail assignment and restoration checks.
Tracked, untracked and streamed SQLite reads refuse incomplete JSON values;
live Postgres and MySQL reads qualify the same refusal without retaining the
failed row or changing stored data. Eighteen regressions preserve symmetric
comparison, cyclic termination and hole/undefined snapshot value semantics.

Postgres introspection now preserves exact owned-sequence identifiers, including
quoted whitespace, dots, quotes and apostrophes. Sequence declarations, schemas
and property generation references preserve those names through generated model
code and recreated native tables. Blank model names remain invalid. Forty-seven
new unit cases and a live round trip also qualify identity options and retained
arithmetic defaults. The new full Postgres generation campaign improves from
49.15% on 118 baseline mutants to 95.04% on 121 repaired-module mutants; the
identifier repair adds three mutants. Focused generation coverage reaches
97.75% lines and 97.5% branches, retaining the defensive empty-name guard.

Identity policy now refuses malformed modes and non-boolean cycling flags before
model configuration can be used. Omitted options keep their established defaults.
Sequence and identity bounds require a minimum strictly below the maximum,
matching native Postgres; valid starts at either endpoint remain supported.
Seventy-three unit cases and three native checks qualify insertion policy,
cycling, exhaustion, safe integers, caches, bigint precision and exact diagnostics.
The three-module store-generation campaign improves from 52.59% on 251 baseline
mutants to 90.98% on 266 repaired-module mutants, with 242 killed and 24 equivalent
optional-bound guards retained. All 292 lines, 97 branches and 26 functions are
covered; no mutants are uncovered, time out or crash the runner.

MySQL type translation and introspection now preserve ENUM and SET literal
values instead of lowercasing stored labels and generated union types. Fifty-six
new unit cases and three native Bookshop checks cover escaped quotes, Unicode,
case, defaults, ORM writes, pulled schema recreation and migration changes.
The two complete-module campaign improves from 46.11% to 99.40% on the same
167-mutant denominator: 166 killed, one equivalent default-array mutant retained,
and no uncovered mutants or runner errors. All 219 lines, 82 branches and five
functions are covered, including deterministic ordering and filtered catalog rows.

The operation-signal wrapper is now qualified across its full module. Twenty-seven
new unit/SQLite cases and ten native cases per provider on both runtimes cover
capability preservation, receiver binding, options, live transaction state,
combined cancellation, rollback and connection reuse. Independent compiled
public probes qualify 24 cases per runtime under strict rejection handling.
All 25 mutants are killed, improving the score from 48% to 100% with no source
changes or runner errors. All 64 lines, 21 branches and seven functions are covered.

JSON refusal now reads constructor diagnostic metadata through descriptors and
uses a stable fallback when inspection fails. Diagnostic traps and accessors
cannot interrupt draining already inspected rejected promises. Sixty-three new
unit/SQLite cases and two native cases per provider on both runtimes cover exact
paths, shared snapshots, hidden metadata, hostile proxies, thenables and retry.
Independent compiled consumers reproduce the original unhandled-rejection crash
and pass after the repair under strict rejection handling on both runtimes.
The four complete-module campaign scores 97.46% on all 276 mutants: 265 killed,
four timeouts, seven equivalent guards retained and no uncovered mutants or
runner errors. The initial campaign scored 59.76% on 164 of 269 raw mutants;
105 runner errors then prevented scoring. Ownership assertions make every final
mutant scoreable, and the diagnostic repair adds seven mutants. All 421 lines and
23 functions are covered, with 99.20% branch coverage; the remaining branch is a
defensive null-prototype diagnostic fallback.

Postgres schema pull now retains numeric precision at scale zero and decodes
signed numeric scale from catalog metadata. Previously, `numeric(10,0)` became
unconstrained `numeric`, and `numeric(2,-3)` became invalid `numeric(2,2045)`.
Seventy-nine new unit cases and three native Bookshop cases qualify generated
schema recreation, rounding, overflow, quoted index keys, expressions, included
columns and partial predicates on both runtimes. The two complete-module
campaign improves from 56.07% on 214 baseline mutants to 98.14% on 215 repaired
mutants, with 211 killed and four retained. All 157 lines, 72 branches and nine
functions are covered; no mutants are uncovered, time out or crash the runner.
The index/sequence facet module kills all 96 mutants. Two redundant alias
mappings and two legacy string-array boundary mutants remain eligible.
The scale decoding matches [PostgreSQL's numeric implementation](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/backend/utils/adt/numeric.c)
and the native PostgreSQL 18.4 catalog representation.

Schema pull now preserves the kinds and order of mixed column/expression index
keys. Previously, mapped columns became raw expressions and generated DDL failed
on SQLite, Postgres and MySQL. The public `hasIndex` builder accepts typed ordered
property/expression descriptors, copies caller records, validates every term
before registration and refuses sparse arrays. Existing property, selector and
expression calls keep their contracts. Sixty-three new unit cases and four native
cases per provider cover both key orders, escaped identifiers, regenerated
metadata and actual uniqueness enforcement on both runtimes.
The two original complete modules scored 48.97% on 145 baseline mutants; their
repaired 171-mutant scope scores 96.49%. The new descriptor module kills all 63
mutants. The expanded three-module campaign scores 97.44% on all 234 mutants:
228 killed, four survivors and two uncovered defensive defaults, with no errors
or timeouts. All 220 lines and ten functions are covered, with 98.97% branches;
the remaining branch is unreachable column handling in the expression-only path.

A test-only query-cache qualification adds 37 unit cases and four native cases
per provider. Warmed row compilation matches fresh compilation across nulls,
negation, logical operands, membership, projection fields, aliases, functions,
nested outputs and literal rebinding. Joined and grouped query keys retain their
SQL shape; mapped JSON equality keeps one parameter across array/object changes.
Strict compiled public-package probes execute all four native cases on every
provider and runtime. All 210 lines, 39 branches and seven functions in three
complete cache-shape modules are covered. The unchanged 103-mutant scope improves
from 39.81% to 89.32%, with 92 killed, 11 equivalent survivors retained and no
uncovered mutants, errors or timeouts. This advisory result remains below the
existing 90% threshold and is excluded from the 23 required mutation campaigns;
SDK source, versions and required gates are unchanged.

Versioned query plans now have five additional public-builder regressions for
legacy defaults, zero paging, scope overrides, grouping, ordered join identity
and private parameter values. The complete unchanged module improves from
61.54% to 100% across all 26 mutants, with 100% coverage of its 56 lines,
14 branches and one function. Strict compiled public probes describe plans
without executing SQL on every provider and runtime; SDK sources are unchanged.

The preceding signed complete coverage checkpoint is
`c26b65bab300aca206540964168a306ebaf9c2f2`, with 95.85% lines, 92.71% branches
and 95.48% functions across 774 runtime files. The preceding query-plan candidate passed
both canonical runtime gates, both live provider suites and the historical
upgrade campaign; retained source attestations match the committed inputs.
Coverage then passed on that clean signed revision. Generated migrations now
retain their reviewed destructive warnings, preserving rename intent and refusing
unapproved removal before user DDL. Legacy snapshot-only migrations keep their
existing checks. The full new 27-mutant warning-validation campaign improves
from 92.59% to 100%, with 100% line and branch coverage. The assertion-only
restoration slice compares identity without formatting opaque causes and
converts two critical runner crashes into ordinary killed mutants.
The cancellation assertion slice records driver-rejection ownership before
test cleanup and observes failures in discarded promise branches. All four
remaining runner errors become ordinary killed mutants, and the empty-handler
deletion fails promptly. Independent compiled API probes pass under Node's
strict unhandled-rejection mode on both runtimes; SDK sources are unchanged.
Each slice retains its own source-attributed qualification receipt.
The API-refinement integration includes all twelve commits through `c0433e97`,
adding checked materialization, constructor-aware set annotations, canonical
write and tracking names, typed predicate linting and source-backed CLI contexts.
The context set-registration base uses a narrow callback so its declaration does
not expose the internal context host. Packed consumers qualify deprecated aliases
and seven predicate misuse cases; compiled Bookshop probes exercise the refined
operations and checked reads on every provider and runtime.
The 22 existing Stryker configurations moved into `config/stryker/`, with identical
loaded options and mutation source hashes. Their fresh test baselines pass after
the move. The critical campaign invalidates and reruns 57 scored results after
seven test files change, retaining its 95.78% score with zero runner errors.
Generated migrations now create principal tables before dependent tables and
remove dependents first. PostgreSQL and MySQL receive separate foreign-key
operations after table creation; SQLite retains inline constraints. Cyclic
SQLite `restrict` data needs explicit cleanup before removing its tables.
The email-claim regression reproduces PostgreSQL `42P01` before the repair and
passes generated creation, populated rollback and inverse migrations afterward.
Sixty new unit cases and four live cases per server provider qualify chains,
self references, cycles, replacement relationships and rebuild alternatives.
The original two-module mutation scope improves from 42.98% (114 mutants) to
91.41% (128 mutants after the repair). The expanded four-module campaign scores
91.57% across 261 mutants, with 236 killed, three timeouts and 22 survivors;
all 365 lines, 107 branches and 21 functions are covered. This becomes the 23rd
required campaign. Both canonical gates pass 559 suites and 4,194 tests;
PostgreSQL passes 38 suites and 180 tests, MySQL 27 suites and 141 tests on both
runtimes. Historical upgrade and rollback, Bookshop, provider shutdown,
performance and seven accepted package archives also qualify this candidate.
SQLite required primary keys now receive explicit `NOT NULL` in schema scripts,
migration builders, scaffolding and rebuilds; new migration-history IDs do too.
Rowid generation and non-reuse remain supported. Forty new unit cases and eight
live cases per server provider qualify valid inserts, null and omitted keys,
optional columns and legacy rebuilds. The original two-module mutation scope
improves from 82.65% (98 mutants) to 96.43% (112 mutants); adding the complete
history-table creation method yields 96.67% across 120 mutants, with 116 killed,
two survivors and two uncovered computed-column defaults. There are no runner
errors or timeouts. The two complete DDL modules cover all 137 lines and three
functions, and 38 of 40 branches. This is the 24th required campaign.
Both canonical gates pass 561 suites and 4,234 tests; PostgreSQL passes 39 suites
and 188 tests, MySQL 28 suites and 149 tests on both runtimes. Compiled public
SDK probes, Bookshop, recovery and shutdown, all thirteen performance workloads,
historical upgrades and seven accepted archives qualify the repair. Older
SQLite required-key callbacks need reviewed original SQL pinned before upgrade:
the historical campaign preserves its original source and fixture, proves the
changed callback is refused without rewriting history, then qualifies the
[reviewed preservation procedure](migrations.md) on all three providers.
All 25 Jest configurations now live in `config/jest/`, including the companions
for migration ordering and required keys. npm and Stryker use explicit paths,
and the base config keeps the repository root as Jest's `rootDir`. Resolved
test selections, module mappings, coverage settings and mutation options remain
unchanged; the generated configuration IDs change with their file locations.
All 24 required mutation campaigns pass fresh sequential test baselines after
the move. Their previous scores retain their original source attribution; this
configuration check does not claim a new complete mutation run. Package sources
are byte-identical to the signed required-key repair.
The review repairs preserve populated SQLite rename chains forward and backward
without data-loss opt-in; all three planning modules have complete line, branch
and function coverage and score 93.94% across 198 eligible mutants. One-to-one
relationships retain unconditional uniqueness on their complete foreign-key
tuple when mixed or filtered indexes are added. Fresh schemas and populated
upgrades qualify on all three providers and both runtimes. The new required
relationship-index campaign covers both complete finalization modules: 144
eligible mutants, 139 killed, five survivors, no uncovered mutants or runner
errors, and 96.53% mutation with complete line, branch and function coverage.
The follow-up index-name repair rejects conflicting definitions with the same
effective database name in the finalized entity, schema renderer and both
supplied diff snapshots. Equivalent declarations remain supported. This
includes unnamed partial indexes and explicitly named mixed indexes colliding
with an inferred one-to-one key; existing generated identifiers stay unchanged.
Distinctly named indexes preserve populated enforcement through creation,
removal and both rollback directions. Nine SQLite/Postgres cases and eight
MySQL cases qualify rejection before schema changes and valid migration paths
on both supported runtimes. The expanded relationship campaign passes 170 tests
across 16 suites on both runtimes and covers all 185 lines, 85 branches and eight
functions. It scores 96% across 175 eligible mutants: 168 killed and seven
survivors, with no timeouts, uncovered mutants or runner errors. The new
physical-name validator kills 29 of 31 mutants; two equivalent substitutions of
its internal term labels remain eligible alongside the five existing survivors.
SQLite schema pull discovers CHECK keywords outside quoted defaults while
retaining original offsets for names and expressions. Fifteen generated-model
round trips preserve both enforcement and constraint names. The complete
four-module parser scope passes 118 tests on both runtimes and scores 90.12%
across 496 eligible mutants; the repaired token matcher has complete line,
branch and function coverage. The overall parser scope has 99.39% line and
98.52% branch coverage with complete function coverage.
Checked materialization accepts precision on `timestamptz` while retaining
Date-instance and finite-time validation. Tracked and untracked saved values
qualify on SQLite and Postgres; MySQL datetime precision remains compatible.
All five precision cases pass on each provider and runtime. The complete
scalar-checker campaign passes 77 focused tests and kills 78 of 80 eligible
mutants (97.50%) with no uncovered mutants or runner errors and complete line,
branch and function coverage. These four review repairs require fresh combined
verification and the full hosted CI matrix on the corrected revision before
merging or publication; the earlier required-key receipts cover their own SHA.
Local campaigns use Node 22.13.0 and Node 24.19.0 on macOS ARM64, Postgres
18.4 on an isolated loopback port, MySQL 8.4.11 in an isolated Docker service,
and temporary SQLite files. Hosted release lanes use `ubuntu-latest` and must
pass on the exact reconciled release SHA before publication.

| Gate | Local evidence |
| --- | --- |
| Canonical verification | Lint, live scoped security audit, strict types, 561 suites / 4,234 tests on both runtimes for the current required-key qualification; production examples, public contracts, reviewed historical upgrade, operations, performance, accepted packages and publication dry runs |
| Public contracts | Ten signature reports and seven package export maps; negative tests for fields, generic constraints, constructors and overloads |
| Package acceptance | Seven actual tarballs; CommonJS/ESM runtimes, Node16/NodeNext types, one core instance, CLI, peer-skew refusal, and an external packed Bookshop SQLite consumer |
| Runtime coverage | 775 executable source files; 95.93% statements/lines, 92.76% branches, 95.57% functions at the clean preceding migration-order checkpoint; all existing floors pass |
| Critical mutation | 95.78% across the original 57-file / 1,401-mutant scope; 1,398 scored mutants, 1,303 killed, 36 timeouts, 52 survivors, seven uncovered and zero runner errors; fresh baseline plus incremental qualification |
| Migration mutation | 98.59% on history initialization, lock ownership and transaction boundaries; no untested mutants |
| Provider validation mutation | 99.27% in a separate campaign for configuration validation before resource allocation; no untested mutants |
| SQLite DDL mutation | 90.57% in a separate four-file / 488-mutant campaign covering schema extraction across quoting, comments and expression boundaries |
| Checksum mutation | 100% across all 120 serializer mutants, including static format constants; 14 fixed digests match the published alpha.1 package |
| Property metadata mutation | 100% across all 104 finalizer mutants; public builder refusals and valid sparse metadata defaults; no untested mutants, errors or timeouts |
| Snapshot rename mutation | 95.83% across all 72 mutants; metadata references, public migration SQL, real dependent renames and rollback |
| SQLite execution mutation | 100% across all 151 mutants; owned transaction, referential checks, cancellation and setting restoration; 100% branch coverage |
| SQLite planning mutation | 94.36% across all 195 mutants in three complete modules; 100% line and branch coverage; physical copy identity, dependent rebuilds and operation grouping |
| Schema DDL mutation | 100% across all 38 mutants in three complete modules; namespace ownership, implicit SQLite schemas and provider callback rendering; 100% line and branch coverage |
| Join planning mutation | 90.51% across all 137 mutants in four complete modules; actual compiled source, retained associations, explicit replacement, principal key/table renames and rollback; all mutants eligible |
| Primary-key order mutation | 98.88% across all 89 mutants; declared tuple order, compatibility metadata and invalid ordinals; 100% branch coverage |
| Migration warning mutation | 100% across all 27 mutants; reviewed lists, malformed metadata, safe rename intent and legacy snapshot fallback; 100% branch coverage |
| Existing key-change mutation | 93.33% across all 30 mutants; typed order refusal, legacy snapshots, physical identity and populated SQLite key transitions; 100% branch coverage |
| Postgres generation mutation | 95.04% across all 121 mutants; identity options, exact sequence identifiers, SQL quoting and default-expression boundaries; executable native round trip |
| Store-generation mutation | 90.98% across all 266 mutants in three complete modules; 100% line, branch and function coverage; policy, reference, numeric and generation-state contracts |
| MySQL type and snapshot mutation | 99.40% across all 167 mutants in two complete modules; exact ENUM and SET values, type aliases, collation handling, ordering and filtered metadata; 100% line, branch and function coverage |
| Operation-signal mutation | 100% across all 25 mutants in the full wrapper; capabilities, receiver binding, options, composed cancellation, transaction state and disposal; 100% line, branch and function coverage |
| JSON validation mutation | 97.46% across all 276 mutants in four complete modules; exact paths, descriptor safety, thenables, promise ownership and retry; 100% line/function coverage and 99.20% branches; no uncovered mutants or runner errors |
| Postgres metadata mutation | 98.14% across all 215 mutants in two complete modules; numeric precision and signed scale, arrays, booleans, index and sequence facets; 100% line, branch and function coverage; index/sequence facets kill all 96 mutants |
| Mixed-index mutation | 97.44% across all 234 mutants in three complete modules; mapped key identity and order, builder ownership, sparse refusal, alternate keys, included properties and skipped-index diagnostics; 100% line/function coverage and 98.97% branches; the new validator kills all 63 mutants |
| Query-plan mutation | 100% across all 26 mutants in the complete unchanged module; versioned shape, legacy defaults, zero paging, tracking and scope flags, grouping and ordered join identity; 100% line, branch and function coverage |
| Required-key mutation | 96.67% across 120 eligible mutants in two complete DDL modules and the SQLite history-table creation method; 116 killed, two survivors and two uncovered defaults; no errors or timeouts |
| Canonical live providers | Postgres: 39 suites / 188 tests; MySQL: 28 suites / 149 tests; both runtimes pass for the current required-key qualification |
| Performance/resources | Thirteen workloads per provider on both runtimes; latency, query/parameter counts, pool pressure, streaming, retained heap/RSS and event-loop budgets pass |
| Framework example | Next.js 16.3.8 production build, migration check/dry run/application/status, and both real Chromium flows against Postgres |

The complete canonical gate is `npm run verify`. CI also requires runtime
coverage, all twenty-six mutation campaigns, both provider lanes on both runtimes, and
the Next.js browser lane. [Contributing](../CONTRIBUTING.md) lists the commands.
Coverage uses two workers that recycle between suites at 512 MiB so V8
debugger state does not accumulate across the entire suite in one process.
The preceding clean complete coverage run at `e02db1e9` took 151 seconds; its inventory rules and floors
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
provider suites and historical upgrades have been rerun for the current schema
repair. Provider Bookshop/performance checks and Postgres browser
flows remain attributed to `49e2a5d402e51d28838db90254a7403bd588bd9c`.
The latest canonical gates rerun SQLite, package and example checks, with their
SDK and test inputs retained in the corresponding slice receipts.

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
