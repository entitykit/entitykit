import { DbContextOptionsBuilder, type DatabaseProviderServices } from './future-core-package';
import {
    futurePostgresProviderServices,
    PostgresDatabaseConnection,
    PostgresSchemaIntrospector,
    type PostgresConnectionConfig,
} from './future-postgres-adapter-package';

export function createFuturePostgresProvider(): DatabaseProviderServices {
    return futurePostgresProviderServices;
}

export function createFuturePostgresConnection(config: string | PostgresConnectionConfig): PostgresDatabaseConnection {
    return new PostgresDatabaseConnection(config);
}

export function createFuturePostgresOptions(config: string | PostgresConnectionConfig): DbContextOptionsBuilder {
    return new DbContextOptionsBuilder()
        .useProvider(futurePostgresProviderServices, config);
}

export function createFuturePostgresIntrospector(connection: PostgresDatabaseConnection): PostgresSchemaIntrospector {
    return new PostgresSchemaIntrospector(connection);
}
