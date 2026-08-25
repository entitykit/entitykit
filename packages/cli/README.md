<p align="center">
  <img src="https://raw.githubusercontent.com/entitykit/entitykit/main/entitykit-logo.svg" alt="EntityKit" width="560">
</p>

<h1 align="center">@entitykit/cli</h1>

<p align="center"><strong>Migrations, inspection, and scaffolding for EntityKit projects.</strong></p>

<p align="center">
  <a href="https://github.com/entitykit/entitykit/blob/main/USAGE.md#configure-migrations">Migrations</a>
  <span> · </span>
  <a href="https://github.com/entitykit/entitykit/blob/main/docs/migrations.md">Guide</a>
  <span> · </span>
  <a href="https://github.com/entitykit/entitykit/blob/main/API.md#cli">API</a>
</p>

The CLI reads `entitykit.config.ts` and operates on source-controlled model
snapshots and migrations. Install it as a development dependency; it is a
build-time tool, not part of the application runtime.

## Install

```sh
npm install -D @entitykit/cli@alpha
```

## First migration

```sh
npx entitykit init
# add entities and mappings to src/db/app-db-context.ts
npx entitykit migration add InitialCreate
npx entitykit db migrate --dry-run
npx entitykit db migrate
```

`init` creates a minimal context and configuration. The generated context is
empty by design; add the application model before creating the first migration.

## Commands

| Command | Purpose |
| --- | --- |
| `init` | Create a minimal EntityKit setup |
| `migration add` | Create a migration from model changes |
| `migration remove` | Remove the latest unapplied local migration |
| `migration list` | List local migration artifacts |
| `migration check` | Check whether the model differs from its snapshot |
| `migration script` | Render reviewable migration SQL |
| `db migrate` | Move a live database to a target migration |
| `db status` | Compare local migrations with a live database |
| `db pull` | Generate starter model code from a live database |
| `completion` | Generate Bash, Fish, or Zsh completion |

Global options include `--config`, `--cwd`, `--json`, `-h` / `--help`, and
`-V` / `--version`. Run `npx entitykit <command> --help` for exact options and
examples.

## Safety

- `db migrate --dry-run` validates the database and prints the exact SQL plan.
- Destructive forward plans require `--allow-data-loss` after review; rollback
  plans can also lose data without that gate.
- Rename hints on `migration add` distinguish a rename from drop-and-add.
- `migration check` and `db status --check` are suitable for CI drift gates.
- Generated migrations and `db pull` output are review artifacts, not blind
  production changes.

## Programmatic use

```ts
import { runEntityKitCli } from "@entitykit/cli";

const result = await runEntityKitCli(["db", "status", "--json"]);
```

The package also exposes versioned command metadata, shell completion,
configuration loading, connection resolution, and machine-readable results.

Read the full [migration guide](https://github.com/entitykit/entitykit/blob/main/docs/migrations.md)
and [provider compatibility](https://github.com/entitykit/entitykit/blob/main/docs/compatibility.md)
before automating deployment.

## License

MIT
