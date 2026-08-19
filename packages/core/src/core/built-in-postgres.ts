import type { PostgresConnectionConfig } from '../storage/built-in-provider-config';
import type { DatabaseProviderServices } from '../storage/database-provider-services';
import { loadBuiltInProviderServices } from './built-in-provider-loader';

const postgresProviderModule = __filename.endsWith('.ts')
    ? '../providers/postgres/postgres-provider-services'
    : 'entitykit/postgres';

/**
 * Lazily loads the built-in Postgres provider services.
 *
 * Core keeps this off its static import graph so `entitykit` does not hard-depend
 * on the `pg` driver and stays ready for the planned `entitykit-postgres`
 * package split. When that split lands, the require target below becomes
 * `require("entitykit-postgres")` and nothing else in core has to change.
 */
export function loadBuiltInPostgresProviderServices(): DatabaseProviderServices<PostgresConnectionConfig> {
    return loadBuiltInProviderServices(
        postgresProviderModule,
        'postgresProviderServices',
        'The built-in Postgres provider could not be loaded. Ensure the \'pg\' package is installed, or configure a provider explicitly with useProvider(...).',
    );
}
