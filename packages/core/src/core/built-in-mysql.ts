import type { MySqlConnectionConfig } from '../storage/built-in-provider-config';
import type { DatabaseProviderServices } from '../storage/database-provider-services';
import { loadBuiltInProviderServices } from './built-in-provider-loader';

const mysqlProviderModule = __filename.endsWith('.ts')
    ? '../../../mysql/src/mysql-provider-services'
    : '@entitykit/mysql';

/**
 * Lazily loads the built-in MySQL provider services.
 *
 * Core keeps this off its static import graph so `@entitykit/core` does not
 * hard-depend on the `mysql2` driver. The adapter ships as its own
 * `@entitykit/mysql` package, which the require target below names.
 */
export function loadBuiltInMysqlProviderServices(): DatabaseProviderServices<MySqlConnectionConfig> {
    return loadBuiltInProviderServices(
        mysqlProviderModule,
        'mySqlProviderServices',
        'The built-in MySQL provider could not be loaded. Ensure the \'mysql2\' package is installed, or configure a provider explicitly with useProvider(...).',
    );
}
