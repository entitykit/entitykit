# @entitykit/testing

**Provider-neutral database test doubles for EntityKit.**

`RecordingDatabaseConnection` records statements, parameters, transactions,
savepoints, and provider sessions without starting a database.

## Install

```sh
npm install -D @entitykit/core@alpha @entitykit/testing@alpha
```

## Use

```ts
import { RecordingDatabaseConnection } from "@entitykit/testing";

const connection = new RecordingDatabaseConnection();
connection.queueResult({ rows: [{ id: "usr_1" }] });
```

Pass the connection to `options.useConnection(connection)`, then assert against
`connection.statements`, `operations`, `transactionEvents`, or `sessionEvents`.
`@entitykit/core` is a peer dependency.

See the [project README](https://github.com/entitykit/entitykit#readme) for the
complete model and alpha boundaries.
