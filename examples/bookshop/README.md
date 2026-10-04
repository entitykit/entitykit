# Bookshop

This private example qualifies EntityKit through a bookstore checkout, using
only public `@entitykit/*` imports. The same application runs on SQLite,
Postgres, and MySQL. It uses the built packages and their declarations, rather
than TypeScript aliases pointing into EntityKit internals.
The package acceptance gate also copies this example into a temporary consumer
outside the checkout, compiles it against the seven accepted tarballs, and runs
its SQLite checkout, concurrent delivery, and process recovery qualification.

`checkout(store, tenantId, actorId, command)` creates a short-lived context and
atomically reserves inventory, increments its optimistic version, creates a
versioned order, appends an audit record, saves a durable response receipt, and
persists `Bookshop.OrderPlaced.v1` through EntityKit's transactional outbox.
EntityKit also populates the order and inventory audit properties. A receipt's
key is `(tenantId, requestId)`; its fingerprint binds the operation, authenticated
tenant, actor, SKU, and quantity. Replay returns the stored original response.
Changing the command or actor under that key fails.

Authenticate and establish tenant and actor authority before calling checkout.
Tenant scope adds query and write enforcement inside the unit of work. The
example uses canonical lowercase identifiers so MySQL's default collation
cannot make two application identities compare equal. The outbox is an
administrative queue shared by tenants; its event payload carries tenant scope.
Direct context/connection access is an application-owned privileged boundary.

All effects in a checkout retry are database effects. Concurrency conflicts get
at most three fresh-context attempts; the data source allows at most three
attempts for provider-classified transient failures. An unknown transaction
outcome propagates. The caller can explicitly replay the same command to
resolve its durable receipt. Delivery and external side effects belong after
commit.

`dispatchPending(store, send, limit)` reads one bounded batch (32 by default,
at most 256), calls the receiver, and acknowledges each event only after the
receiver succeeds. It provides at-least-once delivery, including when the
publisher crashes after sending. `fulfillOrder()` represents a bookstore
fulfillment receiver: its shipment request and delivery receipt commit together.
The receipt binds a stable event ID to the complete canonical payload. Parallel
receivers and restarted publishers can replay an event without creating a
second shipment. Each tenant's shipments and delivery receipts remain scoped.

The demonstration receiver shares the example database. A remote service must
own the same durable deduplication contract in its database, authenticate its
publisher, and commit its receipt with its business effect. Network delivery,
physical shipping, email, and other external side effects need the receiving
system's own idempotency mechanism.

The checkout qualification proves committed state, tenant isolation, invalid
input rejection, command/actor mismatch rejection, rollback after all writes,
stale version rejection, concurrent duplicate requests, and two buyers racing
for the final copy. These assertions execute against real databases with
Node's strict unhandled rejection handling.

Recovery qualification starts separate Node processes and deliberately exits
them after saving inside an open transaction, after checkout commits, and after
fulfillment commits before the publisher acknowledges. Fresh processes replay
the command, and a fresh data source completes delivery. It verifies rollback
of uncommitted state, survival of committed receipts, one fulfillment effect,
and eventual outbox acknowledgment on all three providers. It also exercises
bounded batches, concurrent receivers, and conflicting/forged delivery payloads.
These are application process crashes; database server and storage failure
qualification is a separate operational gate.

From the repository root:

```sh
npm ci
npm run check:bookshop

# Use an isolated database. The runner drops only bookshop_* test tables.
BOOKSHOP_DATABASE_URL=postgres://entitykit:entitykit@127.0.0.1:5432/entitykit_test \
  npm run check:bookshop:postgres
BOOKSHOP_DATABASE_URL=mysql://root:entitykit@127.0.0.1:3306/entitykit_test \
  npm run check:bookshop:mysql
```

SQLite qualification owns a temporary file and removes it afterward. Remote
qualification requires a database name containing `test`, `qualification`, or
`hardening`; database credentials and permissions remain the operator's
responsibility. Remote runs retain their final example state for inspection.

`placeOrder(context, command)` supports composition with other database work,
and requires an explicit transaction. The example's schema setup is for
qualification; review migrations and operational recovery before deploying an
application built from it. EntityKit release versions remain prereleases.
