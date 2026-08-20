# @entitykit/sqlite

The SQLite provider for EntityKit, backed by Node's built-in `node:sqlite`
driver (`DatabaseSync`), so it needs no native dependency. The module is
available without a command-line flag from Node 22.13 onward; some 22.x
releases still print an `ExperimentalWarning` the first time it is loaded.
That warning is informational — the provider works as documented.

Register it with `options.useSqlite(path)` or pass its services to
`options.useProvider(...)`; it also exports the SQLite dialect, the connection,
and a `rawSql` tag for standalone statements.

```bash
npm install @entitykit/core@alpha @entitykit/sqlite@alpha
```

```ts
import { sqliteProviderServices } from "@entitykit/sqlite";
```

`@entitykit/core` is a peer dependency. See the
[EntityKit repository README](../../README.md) for the project overview,
installation, and documentation.
