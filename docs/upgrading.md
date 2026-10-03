# Upgrading EntityKit

Upgrade all used `@entitykit/*` packages to one exact family version. Include
CLI, testing and framework integrations in that review. Check the target's
release notes and [compatibility line](compatibility.md#stable-compatibility-policy),
Node runtime, provider server and driver before changing an application.

The repository's [historical campaign](migration-compatibility.md) proves an
actual published `0.1.0-alpha.1` database can be read, versioned and migrated by
the candidate on SQLite, Postgres and MySQL. It covers a representative schema;
run the same upgrade against an application's real migrations and data before
deployment. Preserve backups and qualify restoration for that deployment.

## Review and rehearse

Retain the deployed lockfile, exact package family, migration files and database
history. Back up the database with the provider's supported mechanism and test
restoring it to a separate instance. A live SQLite database may include WAL
state; a copy of only its main file is not a qualified backup procedure.

Install the target family without peer overrides. Run `npm ls @entitykit/core
--all` and the application's build and tests. Exercise tenancy, optimistic
versions, relationships, bulk writes, transaction retries and shutdown using
the target artifacts. The [Bookshop example](../examples/bookshop/README.md)
provides a complete public-package checkout, durable receipt and delivery
qualification that can be adapted to a non-on-call domain.

Applied migration bodies and checksums are immutable. Keep old migrations and
their recorded EntityKit versions. Use new migrations for new schema changes.
Do not regenerate old SQL or update history rows to match the new SDK version.
Review the checked-in model snapshot and any explicit format transition.

Use the installed CLI to inspect status and render the plan:

```sh
entitykit migration check
entitykit db status
entitykit db migrate --dry-run --output reviewed-upgrade.sql
```

Review every statement, provider-specific operation and data-loss decision.
`migration check` reports model changes; `db status` checks migration history
and checksums. These commands do not prove that every out-of-model database
object matches the application. Inspect hand-authored triggers, extensions and
other owned schema objects separately. Rehearse the reviewed migration and
any rollback on the restored database, then run application smoke tests.

## Apply and verify

Use one migration owner. Postgres and MySQL have database migration locks;
SQLite needs application/operator serialization. Drain or coordinate writers
as required by the reviewed plan, then apply it with the least database
privileges needed. Destructive forward plans require the explicit
`--allow-data-loss` gate. A rollback can also destroy data and needs its own
review; the forward gate does not make it safe.

After application, check `entitykit db status --check`, the actual schema and
expected data. Start the target application, perform representative reads and
writes, verify versions and durable receipts, then confirm contexts and pools
dispose cleanly. Keep the deployment revision, package identities, migration
plan, status and smoke-test results together.

## Recover a failure

SQLite and Postgres transactional migrations roll back work that was not
committed. Postgres operations explicitly marked transaction-suppressed need
separate inspection. A process exit or lost response is not proof that the
server rolled back: inspect the database and history before deciding to retry.

MySQL DDL commits implicitly. A failed or killed migration can leave schema
objects without a completed history row. Stop further migration attempts and
compare the observed schema and data with the reviewed plan. Repair or restore
only known application-owned objects after that inspection. The repository's
[crash drill](provider-qualification.md) drops a known empty partial fixture
table before rerunning; it does not supply a generic destructive repair policy
for an application database.

For application transactions with an unknown commit outcome, use the durable
command receipt to replay the original result. EntityKit's retry policy does
not automatically rerun unknown outcomes. Outbox delivery is at least once;
the receiver needs durable deduplication so a process exit after receiver
commit and before acknowledgment produces one business effect.

To roll back schema, first inspect status and render an explicit target plan:

```sh
entitykit db migrate --to <previous-migration-id> --dry-run
```

Run an approved rollback only if the old application can use the resulting
schema and data. Otherwise restore the qualified backup or apply a reviewed
forward repair. SDK package rollback and database rollback are separate
decisions; changing dependencies alone does not undo an applied migration.
