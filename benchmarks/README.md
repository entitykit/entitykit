# Executable performance qualification

Run `npm run check:performance` for a temporary SQLite file, or use
`check:performance:postgres` / `check:performance:mysql` with
`ENTITYKIT_BENCHMARK_DATABASE_URL` pointing to an isolated loopback test
database. Remote names must contain `test`, `qualification`, or `hardening`.
The runner resets `entitykit_benchmark_records`, `entitykit_benchmark_notes`,
the `entitykit_scaling_*` tables, and the seven Bookshop tables. It uses built public packages and the actual
`node:sqlite`, `pg`, or `mysql2` peer driver.

The dataset has 2,000 records with 192-character payloads and a representative
parent/child include. Paired direct-driver and ORM reads cover primary-key
lookup, 128-row materialization, and a 16-parent split include. Other workloads
cover no-tracking reads, tracked optimistic updates, 64-row saves and upserts,
32 simultaneous reads through a four-connection pool, no-tracking streams with
32-row batches, and atomic Bookshop checkout plus durable delivery.

The expanded gate runs 34 SQL workloads and four context-setup measurements:

| Added area | Populated workload and checked behavior |
| --- | --- |
| Inverse and collection includes | 250 and 1,000 children sharing a parent; two SQL statements, complete inverse graph, unique identities |
| Separately loaded relationships | 250 and 1,000 children; no-op saves submit no SQL, explicit detection builds the complete graph, and both paths preserve their navigation baselines |
| Composite includes | 1,024 distinct two-column parent keys, references and four-child collections; five SQL statements across key chunks |
| Window batching | 33 scalar-key parents, 80 filter bindings, tenant scope and per-parent `skip(1).take(2)`, collection and many-to-many; cap 96 and four statements |
| Converted reads | 1,000 nested JSON values, tracked no-op detect/save and buffered no-tracking; correct values and tracker ownership |
| Generated saves and deletes | 100 and 400 generated-key entities per complete add/save/remove/save cycle; unique persisted identities and empty final tracker |
| Cascades | Reverse-tracked 400-node chain deleted inside a rolled-back caller transaction; graph fixup, affected rows and restored database contents |
| Fast streams | 512 and 4,000 rows at batch sizes 32 and 256, zero consumer yields, zero tracked entries, bounded sampled heap/RSS |
| Context setup | 1, 10, 50 and 100 mapped types with 20 scalar fields each; 40 samples after five warmups, disposal included, no SQL |

The window workloads use scalar keys because the existing composite-key window
strategy loads each parent's window separately. Composite unwindowed includes
exercise shared batching. A lower adapter parameter cap forces real chunk
boundaries; rows on both sides must retain each parent's complete window.
Generated save/delete and cascade timings include the complete named lifecycle,
so they are not isolated measurements of one internal helper.

Every read/application workload has five warmups and 40 measured samples;
batch writes, scaling workloads and pool pressure have eight measured samples. Reports use nearest
rank p50/p95/p99. Each measured operation must emit statement telemetry.
Lookup and materialization execute one application statement, the split include
two, and each 64-row write one. Query budgets exclude driver-internal
transaction and cursor-control commands. Stream row count and zero retained
tracked entities are checked, with explicit consumer yields every 128 rows.
Sixty-four disposed tracking contexts qualify heap retention after forced GC.

The separate fast-stream matrix has no consumer yields. It forces GC before
each measured operation, outside its timer, to measure a stream's allocation
window independently of garbage awaiting collection from preceding samples.
Reports distinguish this preparation from measured work. A separate SQLite
100,000-row recursive CTE must receive a timer-driven abort before completion
and then execute a healthy query. Deterministic heartbeat, iterator cleanup,
accessor refusal, supersession and rollback tests supplement these resource
smoke measurements.

Network stream results also record actual driver `query()` calls independently
of application telemetry. PostgreSQL includes BEGIN, DECLARE, FETCH, CLOSE and
COMMIT; a short final batch needs no empty EOF fetch, while an exact full batch
still requires one. MySQL's unbuffered query uses one driver command. These
counts exclude wire handshake messages. The default batch size stays 100.

| Guardrail | Bound |
| --- | ---: |
| Read p95 | 250 ms |
| Additional paired ORM read p95 | 10 ms |
| Batch write p95 | 2,000 ms |
| Checkout and durable delivery p95 | 1,000 ms |
| Full stream | 10,000 ms |
| Stream heap growth | 64 MiB |
| Heap retained after context disposal and GC | 32 MiB |
| RSS growth | 128 MiB |
| Maximum event-loop delay | 2,000 ms |
| Strict process exit | 90 seconds |

These deliberately broad portable regression limits are qualification budgets,
not production latency promises. SQLite performs synchronous native work; the
provider yields between bounded native row batches without preempting a native call.
Ratios and latency differences are triage evidence on the recorded machine.
With 40 samples, nearest-rank p99 is the maximum observation; with eight, p95
and p99 are both the maximum. These sample sizes do not establish production
tail latency. Compare raw and ORM within a provider/host: ORM samples include
fresh context setup and disposal, while the raw driver reuses its connection
and returns plain rows. Run providers sequentially on an otherwise idle host
when collecting comparison evidence. Temporary in-memory server storage can
qualify ORM work and cancellation, but cannot qualify disk or restart durability.
The final release must rerun the gate on its candidate SHA and supported runtimes.

The minimum-runtime campaign exposed enabled per-context `AsyncLocalStorage`
instances accumulating in Node 22's async-hook propagation list. Idle operation
guards now disable their own scope after the outer operation ends and re-enable
it when reused, preserving nested operations and the caller's application
scope. This follows [Node's documented lifetime contract](https://nodejs.org/download/release/v22.13.0/docs/api/async_context.html#asynclocalstoragedisable).
The same 32-reader batch p95 fell from 250–400 ms to 13–17 ms without changing
any budget. Treat these as local debugging results on the recorded environment.

JSON artifacts are written to `coverage/performance/<provider>.json` (or
`ENTITYKIT_BENCHMARK_OUTPUT_DIR`). They include the candidate Git SHA, dirty
state, EntityKit/Node versions, machine and workload parameters, budgets,
percentiles, statement/parameter counts, paired comparisons and resource
metrics, server version, declared storage and isolated context-setup costs.
CI retains an artifact for each provider and Node verification lane.
No database URL or credentials are included in evidence.

Algorithmic work-count regressions live in `tests/include-collection-scaling`,
`include-key-batching`, `tracked-snapshot-work`, `save-bookkeeping-scaling`,
`deletion-acceptance-scaling`, `cascade-scaling`, `relationship-fixup-scaling`
and `include-filter-bindings`. They assert actual work
bounds rather than elapsed-time ratios. The [performance design notes](../docs/performance.md)
describe the contracts, model-reuse decision and remaining provider opportunities.
