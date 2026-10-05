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
SQLite streams also yield to the event loop after at most `min(batchSize, 256)`
rows, allowing fast consumers to receive timer-driven aborts and heartbeats.
Database server crashes and storage durability have separate failure scenarios.

The remote commands also run the Bookshop checkout through a transparent
unencrypted loopback TCP proxy. The proxy observes the server's successful
COMMIT response and destroys both sockets before forwarding any acknowledgment
to the application. The client must report an unknown transaction outcome,
preserve that classification beneath rollback cleanup failure, and bypass even
an always-retry policy. A fresh direct connection then replays the durable
command receipt and proves exactly one inventory decrement, order, audit,
receipt, and outbox event. The other tenant's inventory and domain rows stay
untouched. The global delivery queue intentionally contains the tenant-scoped
payload. The command resets the seven `bookshop_*` tables as well as the probe.

This proxy supports the plain PostgreSQL protocol and MySQL COM_QUERY with
zero query attributes. It requires loopback targets without TLS options. It
qualifies an actual lost network acknowledgment; it does not simulate disk or
server failure.

Two transactions next lock the same two rows in opposite order. The native
server deadlock victim must carry `40P01` (Postgres) or `ER_LOCK_DEADLOCK`
(MySQL), and the data source retries its complete transaction. Three total
attempts must produce exactly two atomic committed updates. A separate socket
cut after an uncommitted insert must roll back that write, discard its physical
connection, and permit a healthy replacement on the logical lease.

Every provider also runs a migration in a separate process and SIGKILLs it
after table DDL completes, before application data or migration history is
written. SQLite and Postgres must remove the uncommitted table. MySQL must
retain the DDL with an empty table and no history entry. The drill inspects that
specific empty partial table and drops it deliberately before reapplying; it
never treats that procedure as a general repair algorithm. A fresh runner must
recover the migration lock, apply once, repeat without work, and roll back.
These checks also reset `__entitykit_migrations`, `entitykit_crash_probe`, and
`entitykit_deadlock_probe` in the isolated database.

## Database server recovery

`check:server-recovery:postgres` and `check:server-recovery:mysql` add an abrupt
server restart with a committed checkout and another checkout uncommitted.
They reset the Bookshop tables in the isolated database. Set
`ENTITYKIT_OPERATION_DATABASE_URL` and `ENTITYKIT_CRASH_CONTAINER` to the
dedicated service's container name or ID. The controller inspects its image,
database name and bound port before SIGKILL and restart. CI passes each job's
own database service ID; it does not restart Docker itself.

Local native Postgres can instead set `ENTITYKIT_CRASH_POSTGRES_DATA` and
`ENTITYKIT_CRASH_POSTGRES_CTL`. This path is restricted to a temporary cluster
under `/tmp/entitykit-hardening-postgres.*`, with its data directory and bound
port verified against `postmaster.pid`. It uses immediate shutdown and restores
the loopback port and Unix socket when starting the server again.

The controller must complete successfully. A fresh application source must
observe the committed transaction unchanged, replay its receipt, find none of
the interrupted transaction's changes, and accept that command anew. All
processes run with strict promise rejection handling. SQLite is embedded, so
the Bookshop application SIGKILL/exit drills qualify its process recovery.
Storage hardware, filesystem, power-loss and backup recovery are deployment
qualifications beyond this process-restart campaign.
