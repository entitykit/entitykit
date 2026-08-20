# @entitykit/cli

The `entitykit` command-line tool: `init` scaffolds a project, `migration add`
and `migration script` author migrations from a model diff, `db migrate` and
`db status` apply and inspect them, and `db pull` generates a model from an
existing database. It reads `entitykit.config.ts` and also exposes the same
commands programmatically through `runEntityKitCli`. Install it as a dev
dependency — it is a build-time tool, not part of your application runtime.

```bash
npm install -D @entitykit/cli@alpha
```

```ts
import { runEntityKitCli } from "@entitykit/cli";
```

It depends on `@entitykit/core`; the provider package you use stays a
dependency of your own project. See the
[EntityKit repository README](../../README.md) for the project overview,
installation, and documentation.
