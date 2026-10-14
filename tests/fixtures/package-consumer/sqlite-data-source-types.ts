import { createSqliteDataSource, type SqliteDataSourceOptions } from '@entitykit/sqlite';
import { DbContext } from '@entitykit/core';

const options: SqliteDataSourceOptions = { maxIdleConnections: 8, retry: { maxAttempts: 2 } };
const source = createSqliteDataSource('./app.db', options);
class Context extends DbContext {}
const context: Context = source.createContext(Context);
void context;
// @ts-expect-error idle retention is configured with an integer count
createSqliteDataSource('./app.db', { maxIdleConnections: '8' });
// @ts-expect-error the provider's options remain a known object contract
createSqliteDataSource('./app.db', { maxActiveConnections: 8 });
