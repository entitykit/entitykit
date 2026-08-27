# EntityKit × Next.js × Postgres

Lantern Journal is a production-shaped Next.js 16 App Router demo. It pairs a
public editorial site with a small studio, a Server Action mutation path, a JSON
Route Handler, source-controlled migrations, and a real Postgres provider.

This is an application demo, not another EntityKit package. Its manifest pins
the exact `0.1.0-alpha.2` family, and npm links those versions to the matching
workspace packages so the release candidate is qualified as one unit.

## What it demonstrates

- async Server Components querying Postgres directly;
- one application-scoped EntityKit data source and connection pool;
- one fresh, disposed `AppDbContext` per query or mutation;
- tracked draft creation and publication through Server Actions;
- a Node-runtime `/api/posts` Route Handler returning projected DTOs;
- explicit relationship loading for authors and tags;
- a checked-in initial migration and model snapshot;
- a build that does not need or contact a database.

## Requirements

- Node.js 22.13 or newer;
- npm;
- Postgres 18, or Docker with Compose.

## Run it

Install and build the EntityKit workspace first, then start the demo:

```sh
npm install
npm run build
cd examples/nextjs-postgres
cp .env.example .env.local
docker compose up -d --wait
npm run db:migrate:dry
npm run db:migrate
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The migration creates the
schema and inserts a small, deterministic Lantern Journal dataset. Open
`/studio` to create and publish another essay; open `/api/posts` to inspect the
JSON projection.

To use an existing Postgres database, set `DATABASE_URL` in `.env.local` and
skip `docker compose up`.

## Verify it

The static gate needs no database connection:

```sh
npm run lint
npm run typecheck
env -u DATABASE_URL npm run build
```

The live gate expects the migration to be applied and a production build to
exist:

```sh
npx playwright install chromium
npm run db:check
npm run db:status
npm run build
npm run test:e2e
```

On a fresh Linux or CI host, use `npx playwright install --with-deps chromium`
to install the required system libraries as well.

Playwright starts `next start` on port 3100. Its smoke tests read the public
site and JSON endpoint, then create and publish a uniquely named draft.

## The lifecycle contract

`src/db/data-source.ts` lazily creates one `createPostgresDataSource()` for the
Node process. It stores the source on `globalThis` so Fast Refresh and Next.js's
separate page and Route Handler server bundles reuse the same pool. Each
long-lived process or warm serverless instance still owns its own source.

Every repository function and Server Action calls `withDbContext()`. That
helper creates an `AppDbContext`, waits for one unit of work, and disposes the
context in `finally`. Contexts are never shared across requests and concurrent
operations never run through one context.

The data source is process-scoped; the contexts it leases are operation-scoped:

```text
Node process / warm function
└── EntityKit Postgres data source + pg pool
    ├── page query DbContext ── disposed
    ├── Server Action DbContext ── disposed
    └── Route Handler DbContext ── disposed
```

Next.js has no portable application shutdown hook. Do not dispose the shared
source at the end of a request. The hosting process owns its lifetime and closes
its sockets when the process exits. Tune `pool.max` for the number of warm
instances your deployment can create; the demo uses five as a conservative
long-lived-server default.

## Runtime and bundling boundaries

EntityKit is a Node.js library. Every database-backed route declares the
`nodejs` runtime, and every data-access module imports `server-only`. Never
import these modules from a Client Component.

`next.config.ts` lists EntityKit and `pg` in `serverExternalPackages`. The
published EntityKit alpha is CommonJS and uses Node database drivers and module
loading, so this demo deliberately leaves those packages to native Node
`require` instead of bundling them into a browser or Edge graph.

The app does not support:

- Edge runtime, middleware/proxy database access, or static export;
- browsers, Deno, or Bun as the EntityKit runtime;
- writable SQLite files on ephemeral serverless filesystems;
- importing private `dist/` paths or repository source paths.

Pages call Next.js `connection()` before reading from the database. The data
source is also lazy. As a result, `next build` compiles the application without
opening Postgres or requiring `DATABASE_URL`; database access begins only for a
real request, Server Action, Route Handler, or CLI command.

## Authentication and authorization boundary

The studio is intentionally open so the data path stays inspectable. It is safe
only for local evaluation or a private disposable environment. Server Actions
are remotely invokable POST endpoints; hiding a link is not authorization.

Before a public deployment:

1. authenticate every studio request and Server Action;
2. derive `workspaceId` and `authorId` from a trusted server-side session;
3. authorize the requested post before reading or mutating it;
4. add CSRF/origin controls required by the deployment;
5. rate-limit both mutations and the JSON endpoint as appropriate.

Never trust workspace or author identifiers from hidden fields, route params,
or client state. The demo uses server-owned environment values only to select
its deterministic seed identity; they are not an authentication mechanism.

## Migration boundary

`MigrationDbContext` is separate from the request context because the EntityKit
CLI needs a zero-argument `context.create()`. Both inherit the same model. The
migration context owns a short-lived direct provider source; web requests use
the shared application data source.

The initial migration includes demo content to make a fresh database useful
immediately. In a real application, keep durable reference data in migrations
and move environment-specific sample content to an explicit seed job.

Run migrations as a deployment step, before new application instances receive
traffic:

```sh
npm run db:check
npm run db:migrate:dry
npm run db:migrate
npm run db:status
```

Do not run migrations, `ensureCreated()`, or seed work during page rendering,
module initialization, or every serverless cold start. Review generated
migrations and their dry-run SQL before applying them.

## Project map

```text
src/app/                  App Router pages, Server Action, and JSON handler
src/components/           Server-rendered visual components
src/db/data-source.ts     Lazy application-scoped source + context helper
src/db/publication-...    Shared model, request context, migration context
src/db/model/             Plain domain classes
src/db/queries/           Server-only DTO queries
src/db/migrations/        Reviewed migration and canonical snapshot
tests/e2e/                Production-server acceptance tests
```

The public home and article views use projections made from detached DTOs.
Neither a live context nor a tracked entity crosses the server-render boundary.

## Package versions

All EntityKit packages are pinned to exactly `0.1.0-alpha.2`. EntityKit provider
and CLI packages require the same exact core version; mixed family versions are
unsupported. Upgrade the family together, review the generated SQL, and rerun
the full static and live gates.

For the library contract, see the repository [usage guide](../../USAGE.md),
[API reference](../../API.md), and
[compatibility matrix](../../docs/compatibility.md).
