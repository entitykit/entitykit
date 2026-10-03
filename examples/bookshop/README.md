# Bookshop

This private example qualifies EntityKit through a bookstore checkout, using
only public `@entitykit/*` imports. The same application runs on SQLite,
Postgres, and MySQL. It uses the built packages and their declarations, rather
than TypeScript aliases pointing into EntityKit internals.

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

The checkout qualification proves committed state, tenant isolation, invalid
input rejection, command/actor mismatch rejection, rollback after all writes,
stale version rejection, concurrent duplicate requests, and two buyers racing
for the final copy. These assertions execute against real databases with
Node's strict unhandled rejection handling.

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
