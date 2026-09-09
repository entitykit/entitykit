# EntityKit documentation

EntityKit is an Entity Framework-inspired ORM for TypeScript on Node.js. If
this is your first visit, start with the lifecycle below and follow the path
that matches what you are building.

```text
application lifetime
└── one EntityKitDataSource + provider resources / pool
    ├── request / job / unit of work → fresh DbContext → dispose
    ├── request / job / unit of work → fresh DbContext → dispose
    └── application shutdown → dispose the data source
```

A `DbContext` is a short-lived unit of work, not a connection pool and not a
singleton. Create one provider data source for the application, create a fresh
context for each operation, dispose the context first, and close the data source
only when the application shuts down.

## Start here

1. [README](../README.md) — understand the product, packages, quick start, and
   alpha boundary.
2. [Usage guide](../USAGE.md) — define a context, query, save, transact, test,
   and prepare production migrations.
3. [Framework guide](frameworks.md) — apply the lifecycle safely in NestJS 12
   or a Node-runtime Next.js 16 application.
4. [Migration guide](migrations.md) — evolve a real schema with reviewed,
   source-controlled migrations.

## Choose your path

| Goal | Read next |
| --- | --- |
| Build a first EntityKit feature | [Usage](../USAGE.md), then [API](../API.md) |
| Rehydrate constructor-based entities | [Materialization](materialization.md) |
| Compose filters and enable predicate linting | [Query predicates](query-predicates.md) |
| Extract a service without losing creation types | [Creation types](creation-types.md) |
| Use NestJS 12 | [Frameworks: NestJS](frameworks.md#nestjs-12), then [`@entitykit/nestjs`](../packages/nestjs/) |
| Use Next.js 16 with Postgres | [Frameworks: Next.js](frameworks.md#nextjs-16-node-runtime), then the [Next.js + Postgres demo](../examples/nextjs-postgres/) |
| Choose or configure a provider | [Compatibility](compatibility.md#providers), then the SQLite, Postgres, or MySQL package README |
| Design and review migrations | [Migrations](migrations.md) |
| Extend a provider or understand internals | [Architecture](architecture.md), then [Contributing](../CONTRIBUTING.md) |
| Prepare a coordinated release | [Release runbook](releasing.md) |
| Report a problem or vulnerability | [Issue tracker](https://github.com/entitykit/entitykit/issues) or [Security](../SECURITY.md) |

## Reference shelf

- [API reference](../API.md) — public classes, methods, entry points, and
  extension contracts.
- [Compatibility](compatibility.md) — qualified runtimes, providers, module
  systems, and explicit non-goals.
- [Architecture](architecture.md) — package ownership and the query, save,
  provider, migration, and release flows.
- [Contributing](../CONTRIBUTING.md) — repository rules and verification gates.

## Alpha status

The npm `0.1.0-alpha.1` release is the six-package core/provider/CLI/testing
family. The coordinated `0.1.0-alpha.2` source adds `@entitykit/nestjs` and the
source-backed `DbContext` constructor; neither exists in the `alpha.1` registry
set. Upgrade a released EntityKit family together and validate it against the
application's real queries, schema, and migrations.

The [compatibility matrix](compatibility.md) is the source of truth for what is
qualified today. In particular, EntityKit remains Node-only: browser, Edge,
alternative-runtime, native ESM output for the original package family, and
general bundler support are not implied by a framework example.
