# @entitykit/cli

**Migrations, inspection, and scaffolding for EntityKit projects.**

The CLI reads `entitykit.config.ts`. Install it as a development dependency;
it is a build-time tool, not part of the application runtime.

## Install

```sh
npm install -D @entitykit/cli@alpha
```

## Start

```sh
npx entitykit init
npx entitykit migration add InitialCreate
npx entitykit db migrate --dry-run
npx entitykit db migrate
```

Use `db status` to inspect migrations, `migration script` to render SQL, and
`db pull` to generate a model from an existing database.

## Programmatic use

```ts
import { runEntityKitCli } from "@entitykit/cli";

const result = await runEntityKitCli(["db", "status"]);
```

The CLI depends on `@entitykit/core`; provider packages remain dependencies of
the project using them. See the
[project README](https://github.com/entitykit/entitykit#readme) for the complete
workflow and alpha boundaries.
