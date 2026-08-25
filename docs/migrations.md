# Migrations

EntityKit migrations are reviewable TypeScript artifacts. A migration records
the change from one checked-in model snapshot to the next, while the database
records the migration id, checksum, and EntityKit version it actually applied.
That pairing is the contract: generate deliberately, review the SQL plan, and
never rewrite history after it has reached a database.

## Start a project

Install core, one provider, and the CLI. SQLite is the shortest local setup:

```sh
npm install @entitykit/core@alpha @entitykit/sqlite@alpha
npm install --save-dev @entitykit/cli@alpha
npx entitykit init
```

Choose a server provider explicitly when needed:

```sh
npx entitykit init --provider postgres
npx entitykit init --provider mysql
```

`init` creates `entitykit.config.ts` and
`src/db/app-db-context.ts`. If the project already has a `package.json`, it also
adds these scripts without replacing an existing definition:

```json
{
  "scripts": {
    "db:migrate": "entitykit db migrate",
    "db:status": "entitykit db status --check"
  }
}
```

SQLite is the default. Postgres also needs `pg`; MySQL needs `mysql2`. Generated
files are not overwritten unless `--force` is present, so inspect existing
setup before using it.

### Configure the CLI

The config connects the project model, provider services, migration directory,
and database target:

```ts
import { defineEntityKitConfig } from "@entitykit/core";
import { postgresProviderServices } from "@entitykit/postgres";
import { AppDbContext } from "./src/db/app-db-context.js";

export default defineEntityKitConfig({
  context: AppDbContext,
  provider: postgresProviderServices,
  connection: () => process.env.DATABASE_URL,
  migrationsDir: "src/db/migrations",
});
```

`connection` may be a connection string, a typed provider configuration, or a
callback returning either. If neither `connection` nor the legacy
`connectionString` is set, database commands fall back to `DATABASE_URL`.
Keep credentials outside source control.

The CLI discovers the nearest `entitykit.config.ts`, `.mts`, `.cts`, `.js`,
`.mjs`, or `.cjs` at or above the working directory. Use global options when a
repository has an unusual layout:

```sh
npx entitykit --cwd apps/api migration list
npx entitykit --config config/entitykit.config.ts db status
```

The default migration directory is `src/db/migrations`. The default snapshot
is `EntityKitModelSnapshot.ts` inside that directory; set `snapshot` only when
the project needs a different path. Every command also accepts `--json` for one
machine-readable result.

## Run the safe migration loop

The normal loop is small and repeatable:

1. Change entities and model mappings.
2. Add a migration.
3. Review its `up()` and `down()` methods and the new snapshot.
4. Check the model and the live migration history.
5. Preview the exact database plan.
6. Apply it, then check status again.

```sh
npx entitykit migration add AddPostPublishedAt
npx entitykit migration check
npx entitykit db status --check
npx entitykit db migrate --dry-run --output migration-plan.sql
npx entitykit db migrate
npx entitykit db status --check
```

`db migrate` refuses to run when the current model differs from the checked-in
snapshot. Capture model changes in a migration first; do not let runtime model
state get ahead of migration history.

### Preserve renames

A name change can look like a drop followed by an add. Tell the differ when the
old and new objects are the same object so the generated migration preserves
data:

```sh
npx entitykit migration add RenameUsers \
  --rename-table users=accounts

npx entitykit migration add RenameDisplayName \
  --rename-column accounts.full_name=display_name
```

Schema-qualified forms are supported:

```sh
npx entitykit migration add RenameUsers \
  --rename-table app.users=accounts \
  --rename-column app.accounts.full_name=display_name
```

Both options are repeatable. Table hints accept `old_table=new_table` or
`schema.old_table=new_table`; column hints accept
`table.old_column=new_column` or
`schema.table.old_column=new_column`. Review the generated operation—rename
hints are explicit intent, not a fuzzy matching system.

### Inspect and remove local artifacts

```sh
npx entitykit migration list
npx entitykit migration check
npx entitykit migration remove
```

- `migration list` reads local artifacts only.
- `migration check` compares the current model with the checked-in snapshot and
  exits non-zero when changes are pending, which makes it suitable for CI.
- `migration remove` removes only the latest local migration, restores its
  previous snapshot, and normally connects to the database to prove that the
  migration was not applied.

Use `migration remove --offline` only when a database cannot be reached and you
have independently proved the latest migration was never applied. If it was
applied, migrate the database back first. Never delete an applied migration to
make local history look clean.

`migration add --empty` creates an intentional empty artifact for a reviewed
backfill or provider-specific operation. `migration add <name> --stdout` prints
a standalone stub without loading config or writing files.

## Review before applying

Generated migrations are source code, not opaque state. Review all of these in
the same change:

- the generated `up()` path;
- the generated `down()` path;
- warning comments for drops or lossy column changes;
- any `builder.sql(...)` data movement or provider-specific SQL;
- the model snapshot; and
- the live plan from `db migrate --dry-run`.

`migration add` writes destructive changes but reports them as warnings.
Applying a forward plan containing those changes is different: `db migrate`
stops unless `--allow-data-loss` is present.

```sh
npx entitykit db migrate --dry-run --output reviewed-plan.sql
# inspect the migration, plan, backup, and deployment window
npx entitykit db migrate --allow-data-loss
```

`--allow-data-loss` is an acknowledgement, not a safety mechanism. Use it only
after the exact plan has been reviewed and recoverable backups exist. Rollback
paths can also discard data even when the forward-operation warning gate does
not apply, so give `down()` and rollback previews the same scrutiny.

Once a migration has been applied anywhere, treat its id and contents as
immutable. EntityKit checks applied migration checksums and refuses missing,
changed, duplicate, skipped, or out-of-order history. Fix production with a new
forward migration; restore an accidentally changed local file from source
control.

`db status --check` compares local artifacts with the database's EntityKit
migration history. Its drift report covers history and checksums; it is not a
full introspection diff of arbitrary live schema changes.

## Preview, apply, and roll back

With no target, `db migrate` moves to the latest local migration. A target may
be a full id, a migration name, the id's name suffix, `latest`, or `0`:

```sh
# Forward to latest.
npx entitykit db migrate --dry-run
npx entitykit db migrate

# Move to the state after AddUsers, rolling newer migrations down.
npx entitykit db migrate --to AddUsers --dry-run
npx entitykit db migrate --to AddUsers

# Roll every migration back.
npx entitykit db migrate --to 0 --dry-run
npx entitykit db migrate --to 0
```

Dry runs read and validate live migration history without creating the history
table or changing the database. They emit the same ordered up/down range the
runner will consume. `--output` is accepted only with `--dry-run`.

Always run `db status` before choosing a rollback target. A target names the
state *after* that migration; use the preceding migration—or `0`—to roll the
named migration itself back.

## Generate deployment scripts

`migration script` renders SQL from source-controlled artifacts without
connecting to a database or applying anything:

```sh
# From an empty database through the latest migration.
npx entitykit migration script --from 0 --to latest --output deploy.sql

# Render a rollback range.
npx entitykit migration script --from AddBilling --to AddUsers

# Postgres-only, forward-only deployment script.
npx entitykit migration script --idempotent --output deploy-idempotent.sql
```

`--from` means the state after that migration and defaults to `0`; `--to`
defaults to `latest`. The generator can render a reverse range when `from` is
newer than `to`.

Idempotent scripts are currently supported only by Postgres. SQLite and MySQL
do not provide the required idempotent block primitive. Idempotent rollback
scripts are unsupported, and an idempotent script also refuses migrations with
statements that must run outside the migration transaction.

## Pull an existing schema

`db pull` introspects a live database and creates starter entity and context
code. It does not alter the database, create migration artifacts, or mark a
baseline as applied.

```sh
# Preview every generated file and diagnostic.
npx entitykit db pull --stdout

# Write to src/db/pulled (the default).
npx entitykit db pull

# Select schemas and choose the output and context name.
npx entitykit db pull \
  --schema app \
  --schema audit \
  --output src/db/imported \
  --context ImportedDbContext
```

Generated files are collision-safe and are not overwritten without `--force`.
Treat them as a starting point. Review every diagnostic about generated names,
keyless tables, skipped relationships or indexes, provider generation, and
store types needing converters. Then integrate the model deliberately and use
`migration check` to understand its relationship to the checked-in snapshot.

Pulling an existing database is not the same as baselining it. Do not apply an
initial create migration to that database merely because the generated model
matches it; decide how migration history will be established and verify that
plan separately.

## Provider boundaries

The migration model is shared, but DDL, locking, transactions, and
introspection remain provider-owned behavior.

| | SQLite | Postgres | MySQL |
| --- | --- | --- | --- |
| Migration serialization | No migration lock; coordinate one runner | Session advisory lock | Database-scoped `GET_LOCK` / `RELEASE_LOCK` on one pinned session |
| DDL transaction behavior | Transactional where SQLite permits it; table rebuilds need special review | Transactional by default; explicitly suppressed operations such as concurrent indexes run outside it | DDL implicitly commits and is emitted outside the migration transaction |
| Idempotent scripts | Not supported | Forward scripts supported when every statement can stay transactional | Not supported |
| Default `db pull` scope | The implicit `main` database | `public` | The connection's selected database |

### SQLite

- The provider uses Node's built-in `node:sqlite` driver.
- SQLite has one implicit `main` schema for EntityKit introspection; attached
  databases are out of scope. `--schema main` is accepted, but other names
  produce an empty pull.
- SQLite cannot alter columns or add/drop constraints in place. EntityKit
  scaffolds table rebuilds for affected model changes and copies mapped columns
  into the rebuilt table. Review copy columns, constraints, indexes, both
  directions, free disk space, and a file backup.
- SQLite exposes no provider migration lock. Avoid concurrent deployers even
  though ordinary database locking still exists.

### Postgres

- `db pull` defaults to `public`; repeat `--schema` to include additional
  schemas. Sequences, generated columns, checks, expression/included/partial
  indexes, and relationships are introspected when representable.
- Migration runners use a session advisory lock. Most DDL is transactional;
  explicitly transaction-suppressed SQL is split out and reported.
- Postgres is the only built-in provider that currently supports
  `migration script --idempotent`.

### MySQL

- The provider targets MySQL through `mysql2`. A database must be selected in
  the connection unless `--schema` names one or more databases to inspect.
  MySQL's current database is emitted unqualified; explicitly pulled external
  databases remain qualified.
- Migration runners hold a database-scoped named lock on one pinned session.
  That prevents competing EntityKit runners, but it does not make MySQL DDL
  atomic.
- MySQL DDL implicitly commits. A failed multi-statement migration can leave
  earlier DDL applied even though its history row was not written. Prefer small
  migrations, fresh backups, exact dry runs, and post-failure schema inspection
  before retrying.
- Concurrent index creation, the provider-neutral index-rename operation, and
  idempotent migration scripts are not supported. Use reviewed provider SQL or
  drop/recreate operations where appropriate.

For the broader runtime and database support contract, read
[Compatibility](./compatibility.md). For public entry points, read the
[API reference](../API.md).
