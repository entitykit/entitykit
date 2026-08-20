# @entitykit/mysql

The MySQL provider for EntityKit, backed by the `mysql2` driver. It carries the
concrete MySQL services, pooled data source, schema introspector, and dialects,
and stays off core's import graph so a project that never uses MySQL never
loads `mysql2`. Register it with `options.useMySql(connectionString)` or pass
its services to `options.useProvider(...)`.

```bash
npm install @entitykit/core@alpha @entitykit/mysql@alpha mysql2
```

```ts
import { mySqlProviderServices } from "@entitykit/mysql";
```

`@entitykit/core` and `mysql2` are peer dependencies. See the
[EntityKit repository README](../../README.md) for the project overview,
installation, and documentation.
