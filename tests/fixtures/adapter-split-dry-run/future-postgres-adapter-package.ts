import type { DatabaseProviderServices } from './future-core-package';
import { PostgresDatabaseConnection } from '../../../packages/postgres/src/pg-database-connection';
import { PostgresSchemaIntrospector } from '../../../packages/postgres/src/postgres-schema-introspector';
import {
    postgresProviderServices,
    type PostgresConnectionConfig,
} from '../../../packages/postgres/src/postgres-provider-services';

export { PostgresDatabaseConnection, PostgresSchemaIntrospector };
export type { PostgresConnectionConfig };

export const futurePostgresProviderServices: DatabaseProviderServices = postgresProviderServices;
