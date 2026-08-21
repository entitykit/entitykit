# @entitykit/core

**The provider-neutral runtime for EntityKit.**

Use ordinary TypeScript classes with `DbContext`, fluent model mapping, typed
queries, change tracking, migrations, and transactional writes. Core carries
no database driver.

## Install

```sh
npm install @entitykit/core@alpha @entitykit/sqlite@alpha
```

Choose `@entitykit/postgres` or `@entitykit/mysql` instead when appropriate.

## Start

```ts
import { DbContext, type DbContextOptionsBuilder } from "@entitykit/core";

class AppDbContext extends DbContext {
  protected override configure(options: DbContextOptionsBuilder): void {
    options.useSqlite("./app.db");
  }
}
```

## Includes

- `/migrations` for migration authoring and execution
- `/adapter` for custom-provider contracts
- `/tooling` for schema introspection and code generation
- `/experimental` for unstable compiler and tooling internals

EntityKit requires Node 22.13 or newer. See the
[project README](https://github.com/entitykit/entitykit#readme) for the complete
model, package map, and alpha boundaries.
