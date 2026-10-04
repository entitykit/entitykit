# Executable performance qualification

Run `npm run check:performance` for a temporary SQLite file, or use
`check:performance:postgres` / `check:performance:mysql` with
`ENTITYKIT_BENCHMARK_DATABASE_URL` pointing to an isolated loopback test
database. Remote names must contain `test`, `qualification`, or `hardening`.
The runner resets `entitykit_benchmark_records`, `entitykit_benchmark_notes`,
and the seven Bookshop tables. It uses built public packages and the actual
`node:sqlite`, `pg`, or `mysql2` peer driver.

The dataset has 2,000 records with 192-character payloads and a representative
parent/child include. Paired direct-driver and ORM reads cover primary-key
lookup, 128-row materialization, and a 16-parent split include. Other workloads
cover no-tracking reads, tracked optimistic updates, 64-row saves and upserts,
32 simultaneous reads through a four-connection pool, no-tracking streams with
32-row batches, and atomic Bookshop checkout plus durable delivery.

Every read/application workload has five warmups and 40 measured samples;
batch writes and pool pressure have eight measured samples. Reports use nearest
rank p50/p95/p99. Each measured operation must emit statement telemetry.
Lookup and materialization execute one application statement, the split include
two, and each 64-row write one. Query budgets exclude driver-internal
transaction and cursor-control commands. Stream row count and zero retained
tracked entities are checked, with explicit consumer yields every 128 rows.
Sixty-four disposed tracking contexts qualify heap retention after forced GC.

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
consumer yields help fairness between steps without preempting a native call.
Ratios and latency differences are triage evidence on the recorded machine.
The campaign passes on Node 22.13 and Node 24 with SQLite, Postgres 18.4 and
MySQL 8.4.11; the final release must rerun the gate on its candidate SHA.

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
metrics. CI retains an artifact for each provider and Node verification lane.
No database URL or credentials are included in evidence.
