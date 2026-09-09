<p align="center">
  <img src="https://raw.githubusercontent.com/entitykit/entitykit/main/entitykit-logo.svg" alt="EntityKit" width="560">
</p>

<h1 align="center">@entitykit/nestjs</h1>

<p align="center"><strong>Lifecycle-safe EntityKit contexts for NestJS.</strong></p>

<p align="center">
  <a href="https://github.com/entitykit/entitykit/blob/main/docs/frameworks.md#nestjs-12">Guide</a>
  <span> · </span>
  <a href="https://github.com/entitykit/entitykit/blob/main/API.md#nestjs">API</a>
  <span> · </span>
  <a href="https://github.com/entitykit/entitykit/blob/main/docs/compatibility.md">Compatibility</a>
</p>

Nest owns one provider data source for the application. Feature services receive
a runner that creates a fresh `DbContext` for each unit of work and always
disposes it. A context is never accidentally shared between concurrent requests.

> [!IMPORTANT]
> This package begins with the coordinated `0.1.0-alpha.2` EntityKit family. It
> was not part of the `0.1.0-alpha.1` six-package release.

The integration targets NestJS 12 and emits native ESM. Configure the consuming
application with `"type": "module"` and TypeScript `module` and
`moduleResolution` set to `NodeNext`. Nest's decorators also require:

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

## Install

Install the coordinated family after `alpha.2` is promoted:

```sh
npm install @entitykit/core@alpha @entitykit/postgres@alpha @entitykit/nestjs@alpha \
  pg @nestjs/common@^12 @nestjs/core@^12 reflect-metadata rxjs
```

Before promotion, consume the workspace build; the `alpha.1` registry family
does not contain `@entitykit/nestjs`.

## Define a context

Passing a data source to `DbContext` now configures it by convention, so a
server context only needs its sets and model:

```ts
import { DbContext, type ModelBuilder } from "@entitykit/core";

export class User {
  id!: string;
  email!: string;
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

## Register once

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

Use `forRootAsync()` when configuration comes from injected Nest providers.
The root module is global; `forFeature()` exports only the runners a feature
declares.

The example below uses the optional `@nestjs/config` package:

```sh
npm install @nestjs/config
```

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

## Run one unit of work

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
    return this.contexts.run(db => db.users.orderBy(user => user.email).toArray());
  }
}
```

`run()` awaits the callback and context disposal. If both fail, it throws an
`AggregateError` containing both failures instead of hiding either one.

## Request-specific context arguments

Constructor arguments after the data source flow through `run()`:

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

Keep authentication and tenant authorization in your application. Pass only a
trusted server-side tenant identity into the context.

## Shutdown and ownership

By default, EntityKit closes the data source during Nest application shutdown.
Call `app.enableShutdownHooks()` if OS signals should trigger Nest lifecycle
hooks. Use `ownership: "external"` only when another component owns disposal.

Do not register a raw `DbContext` as a singleton or request-scoped provider.
Contexts are non-concurrent units of work, and Nest does not run lifecycle hooks
for request-scoped providers. The runner is the safe boundary.

For a complete framework walkthrough and the Next.js 16 Node-runtime pattern,
read the [framework guide](https://github.com/entitykit/entitykit/blob/main/docs/frameworks.md).

## License

MIT
