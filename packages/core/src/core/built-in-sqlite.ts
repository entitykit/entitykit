import type { SqliteConnectionConfig } from '../storage/built-in-provider-config';
import type { DatabaseProviderServices } from '../storage/database-provider-services';
import { loadBuiltInProviderServices } from './built-in-provider-loader';

const sqliteProviderModule = __filename.endsWith('.ts')
    ? '../../../sqlite/src/sqlite-provider-services'
    : '@entitykit/sqlite';

/**
 * Lazily loads the built-in SQLite provider services.
 *
 * Core keeps this off its static import graph so `@entitykit/core` does not pull
 * in the SQLite adapter (or require Node's `node:sqlite`) until a context
 * actually asks for it. The adapter ships as its own `@entitykit/sqlite`
 * package, which the require target below names.
 */
export function loadBuiltInSqliteProviderServices(): DatabaseProviderServices<SqliteConnectionConfig> {
    return loadBuiltInProviderServices(
        sqliteProviderModule,
        'sqliteProviderServices',
        'The built-in SQLite provider could not be loaded. It uses Node\'s built-in node:sqlite (Node >= 22.13); upgrade Node, or configure a provider explicitly with useProvider(...).',
    );
}
