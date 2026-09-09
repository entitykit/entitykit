# Framework integrations

Framework adapters should preserve EntityKit's ownership model instead of
hiding it:

1. create one provider data source for the application;
2. create a fresh `DbContext` for each request, job, or unit of work;
3. await the work and dispose that context on every path;
4. dispose the data source only during application shutdown.

The optional `DbContext` data-source constructor makes this convention the
default. A source-backed context only needs its sets and model:

```ts
import { DbContext, type ModelBuilder } from "@entitykit/core";

export class User {
  id = "";
  email = "";
}

export class AppDbContext extends DbContext {
  readonly users = this.set(User);

  protected override model(model: ModelBuilder): void {
    model.entity(User, entity => {
      entity.toTable("users");
      entity.hasKey(user => user.id);
      entity.property(user => user.id).hasColumnType("text").isRequired();
      entity.property(user => user.email).hasColumnType("text").isRequired();
    });
  }
}
```

Initialization selects the constructor-supplied source before `configure()`.
An override can add diagnostics, tenant scope, or auditing directly; no base
call is needed. Selecting a second provider or source is an error.

> [!IMPORTANT]
> This guide targets `0.1.0-alpha.2`. Previous `0.1.0-alpha.1` contexts must
> select a shared source explicitly with `options.useDataSource(source)` in
> `configure()`.

## NestJS 12

> [!IMPORTANT]
> `@entitykit/nestjs` begins with the coordinated `0.1.0-alpha.2` family. It was
> not part of the `0.1.0-alpha.1` six-package release. Use the workspace build
> until `alpha.2` is promoted on npm.

The integration emits native ESM and targets NestJS 12. Configure the consuming
application as ESM—typically with `"type": "module"` and TypeScript
`module`/`moduleResolution` set to `NodeNext`—and enable Nest's decorator
metadata:

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

After the coordinated release is available, the install shape is:

```sh
npm install @entitykit/core@alpha @entitykit/postgres@alpha @entitykit/nestjs@alpha pg \
  @nestjs/common@^12 @nestjs/core@^12 reflect-metadata rxjs
```

### Register the application data source

Use `EntityKitModule.forRoot()` when configuration is already available:

```ts
import { Module } from "@nestjs/common";
import { EntityKitModule } from "@entitykit/nestjs";
import { createPostgresDataSource } from "@entitykit/postgres";
import { AppDbContext } from "./app-db-context.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

@Module({
  imports: [
    EntityKitModule.forRoot({
      dataSource: createPostgresDataSource(databaseUrl),
    }),
    EntityKitModule.forFeature([AppDbContext]),
  ],
})
export class AppModule {}
```

The root module is global and exports the application-scoped data source.
`forFeature()` registers only the context runners named by that feature.

Use `forRootAsync()` when Nest must resolve configuration first:

```sh
npm install @nestjs/config
```

The configuration package is used by this example, not required by
`@entitykit/nestjs` itself.

```ts
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { EntityKitModule } from "@entitykit/nestjs";
import { createPostgresDataSource } from "@entitykit/postgres";

@Module({
  imports: [
    EntityKitModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        dataSource: createPostgresDataSource(
          config.getOrThrow<string>("DATABASE_URL"),
        ),
      }),
    }),
  ],
})
export class DatabaseModule {}
```

### Run one unit of work

Inject `EntityKitContextRunner`, not a raw context:

```ts
import { Injectable } from "@nestjs/common";
import {
  EntityKitContextRunner,
  InjectEntityKitContextRunner,
} from "@entitykit/nestjs";
import { AppDbContext, type User } from "./app-db-context.js";

@Injectable()
export class UsersService {
  constructor(
    @InjectEntityKitContextRunner(AppDbContext)
    private readonly contexts: EntityKitContextRunner<AppDbContext>,
  ) {}

  list(): Promise<User[]> {
    return this.contexts.run(db =>
      db.users.orderBy(user => user.email).toArray(),
    );
  }
}
```

`run()` creates one context, awaits the callback, and disposes the context on
success or failure. If work and disposal both fail, it throws an
`AggregateError` containing both failures.

Context constructor arguments after the data source flow through `run()`. This
is useful for a trusted server-side tenant identity:

```ts
import {
  type DbContextOptionsBuilder,
  type EntityKitDataSource,
} from "@entitykit/core";
import type { EntityKitContextRunner } from "@entitykit/nestjs";
import { AppDbContext } from "./app-db-context.js";

class TenantDbContext extends AppDbContext {
  constructor(source: EntityKitDataSource, private readonly tenantId: string) {
    super(source);
  }

  protected override configure(options: DbContextOptionsBuilder): void {
    options.useTenantScope(() => this.tenantId);
  }
}

function listOrders(
  contexts: EntityKitContextRunner<TenantDbContext, [tenantId: string]>,
  trustedTenantId: string,
) {
  return contexts.run(db => db.users.toArray(), trustedTenantId);
}
```

Authentication and tenant authorization remain application responsibilities.
Never pass an untrusted route parameter or request field as the tenant identity.

### Shutdown and ownership

The default ownership is `"module"`: `EntityKitModule` disposes the data source
from Nest's `onApplicationShutdown()` lifecycle. Call
`app.enableShutdownHooks()` when operating-system signals should trigger those
hooks. Use `ownership: "external"` only when another component owns and awaits
data-source disposal.

Do not register a `DbContext` as a singleton or request-scoped provider.
Contexts reject concurrent work, and Nest does not run lifecycle hooks for
request-scoped providers. The runner is the lifecycle-safe boundary.

See the [`@entitykit/nestjs` package guide](../packages/nestjs/) for the compact
package reference.

## Next.js 16 Node runtime

The [Next.js + Postgres demo](../examples/nextjs-postgres/) is a
production-shaped App Router example whose manifest pins the exact
`0.1.0-alpha.2` workspace family. The app shows Server Components, a Server
Action, a Route Handler, source-controlled migrations, and a real Postgres data
path.

The safe shape has four parts:

- put EntityKit access in modules that import `server-only`;
- declare `export const runtime = "nodejs"` for database-backed routes;
- keep one lazy application data source per Node process or warm instance;
- create and dispose one context inside every query or mutation helper.

```ts
import "server-only";

import { createPostgresDataSource } from "@entitykit/postgres";
import { AppDbContext } from "./app-db-context";

type AppDataSource = ReturnType<typeof createPostgresDataSource>;

declare global {
  // `var` shares one pool across server bundles and development reloads.
  var entityKitDataSource: AppDataSource | undefined;
}

function getDataSource(): AppDataSource {
  const existing = globalThis.entityKitDataSource;
  if (existing) {
    return existing;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const created = createPostgresDataSource(databaseUrl);
  globalThis.entityKitDataSource = created;
  return created;
}

export async function withDbContext<TResult>(
  work: (db: AppDbContext) => Promise<TResult>,
): Promise<TResult> {
  const db = getDataSource().createContext(AppDbContext);
  try {
    return await work(db);
  } finally {
    await db.dispose();
  }
}
```

Cache the source on `globalThis` so Fast Refresh and Next.js's separate page and
Route Handler server bundles reuse one pool in the same Node process. Each
long-lived process or warm serverless instance still owns its own source. Size
the pool for the maximum number of warm instances the deployment may create.

The published alpha packages and `pg` should remain Node externals rather than
being pulled into a browser or Edge graph:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@entitykit/core",
    "@entitykit/postgres",
    "pg",
  ],
};

export default nextConfig;
```

Next.js has no portable application-shutdown hook. Do not dispose the shared
source at the end of a request; dispose every context, and let the hosting
process own the source lifetime. Run migrations as a deployment step, not
during module initialization, `next build`, rendering, or a serverless cold
start. A separate zero-argument migration context is the clearest CLI boundary.

This demo is not a general bundler qualification. Edge runtime, browsers,
Deno, Bun, static export, Client Component imports, and arbitrary bundler
resolution remain unsupported. General Next.js/bundler support must stay
unqualified until a required gate builds the exact packed artifacts and proves
the live production runtime path. See [Compatibility](compatibility.md) for the
current contract.
