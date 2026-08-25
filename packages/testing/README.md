<p align="center">
  <img src="https://raw.githubusercontent.com/entitykit/entitykit/main/entitykit-logo.svg" alt="EntityKit" width="560">
</p>

<h1 align="center">@entitykit/testing</h1>

<p align="center"><strong>Provider-neutral recording test doubles for EntityKit.</strong></p>

<p align="center">
  <a href="https://github.com/entitykit/entitykit/blob/main/USAGE.md#test-without-a-database">Usage</a>
  <span> · </span>
  <a href="https://github.com/entitykit/entitykit/blob/main/API.md#testing">API</a>
</p>

`RecordingDatabaseConnection` captures SQL, parameters, transactions,
savepoints, and provider sessions without starting a database.

## Install

```sh
npm install -D @entitykit/core@alpha @entitykit/testing@alpha
```

## Use

```ts
import { DbContext, type DbContextOptionsBuilder } from "@entitykit/core";
import { RecordingDatabaseConnection } from "@entitykit/testing";

const connection = new RecordingDatabaseConnection();

class TestDbContext extends DbContext {
  protected override configure(options: DbContextOptionsBuilder): void {
    options.useConnection(connection);
  }
}

connection.queueResult({ rows: [{ id: "usr_1" }], rowCount: 1 });

await using db = TestDbContext.create();
await db.database.sql`select id from users`;

expect(connection.statements).toEqual([
  { text: "select id from users", values: [] },
]);
```

## Recordings

| Property | Contains |
| --- | --- |
| `statements` | SQL text and bound values |
| `operations` | Queries, transaction work, savepoints, and sessions in order |
| `transactionEvents` | Begin, commit, rollback, and savepoint lifecycle |
| `sessionEvents` | Provider-session lifecycle |

Queue rows with `queueResult()` and failures with `queueError()`. Dedicated
helpers can fail the next transaction or savepoint operation for recovery-path
tests.

This package is a unit-test tool. Keep live provider integration coverage for
behavior owned by SQLite, Postgres, or MySQL.

## License

MIT
