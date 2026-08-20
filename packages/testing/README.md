# @entitykit/testing

Provider-neutral test doubles for EntityKit. `RecordingDatabaseConnection`
stands in for a real connection and records every statement, parameter set, and
transaction or savepoint boundary a context would issue, so a test can assert
the SQL a save or query produces without a database running.

```bash
npm install -D @entitykit/core@alpha @entitykit/testing@alpha
```

```ts
import { RecordingDatabaseConnection } from "@entitykit/testing";
```

`@entitykit/core` is a peer dependency. See the
[EntityKit repository README](../../README.md) for the project overview,
installation, and documentation.
