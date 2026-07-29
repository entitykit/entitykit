import type { DatabaseProviderServices } from './future-core-package';
import { PostgresDatabaseConnection } from '../../../src/providers/postgres/pg-database-connection';
import { PostgresSchemaIntrospector } from '../../../src/providers/postgres/postgres-schema-introspector';
import {
    postgresProviderServices,
    type PostgresConnectionConfig,
} from '../../../src/providers/postgres/postgres-provider-services';

export { PostgresDatabaseConnection, PostgresSchemaIntrospector };
export type { PostgresConnectionConfig };

export const futurePostgresProviderServices: DatabaseProviderServices = postgresProviderServices;
