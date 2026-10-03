# Provider operational qualification

Run `npm run check:operations` for SQLite. For isolated remote databases:

```sh
ENTITYKIT_OPERATION_DATABASE_URL=postgres://localhost/entitykit_test npm run check:operations:postgres
ENTITYKIT_OPERATION_DATABASE_URL=mysql://localhost/entitykit_test npm run check:operations:mysql
```

Each command builds the packages and runs a separate strict Node process.
The remote database name must contain `test`, `qualification`, or `hardening`.
The campaign creates and drops `entitykit_operation_probe`; use a disposable
database with no application data. SQLite uses a temporary file and removes it.

The admission checks cover queries, streams, transactions, and pinned sessions.
Preaborted operations execute no work. On Postgres and MySQL, a pinned session
fills a one-connection pool while three rounds of 32 operations queue and
cancel. Canceled inserts leave no rows and canceled callbacks never execute.
A healthy query behind every canceled waiter proves late connections returned
to the pool. Cancellation must settle within one second while the holder is
still occupied.

The wire-query checks cancel four five-second server sleeps within one second
and reuse the pool immediately. The stream checks run 20 consumer cancellation
or early-return cycles with batch size seven. Healthy queries after each cycle,
a two-second shutdown bound, strict promise rejection handling, and a
30-second child process deadline detect abandoned ownership and open handles.
The script fails if late resource cleanup emits its failure warning.

These deadlines are generous correctness limits for isolated qualification,
not production latency targets. SQLite runs synchronously and checks abort
signals between native steps; it cannot preempt a running native statement.
Database server crashes, storage durability, lost commit acknowledgment, and
migration repair have separate failure scenarios.
