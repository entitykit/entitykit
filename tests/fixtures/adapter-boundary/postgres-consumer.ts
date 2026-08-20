import {
    DbContext,
    type DbContextOptionsBuilder,
} from '../../../packages/core/src';
import {
    PostgresDatabaseConnection,
    PostgresSchemaIntrospector,
    postgresProviderServices,
    type PostgresConnectionConfig,
} from '../../../packages/postgres/src';

export function createBuiltInPostgresConnection(config: string | PostgresConnectionConfig): PostgresDatabaseConnection {
    return new PostgresDatabaseConnection(config);
}

class BuiltInPostgresContext extends DbContext {
    constructor(private readonly config: string | PostgresConnectionConfig) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options
            .usePostgres(this.config)
            .useProvider(postgresProviderServices, this.config);
    }
}

export function createBuiltInPostgresOptions(
    config: string | PostgresConnectionConfig,
): BuiltInPostgresContext {
    return BuiltInPostgresContext.create(config);
}

export function createBuiltInPostgresIntrospector(connection: PostgresDatabaseConnection): PostgresSchemaIntrospector {
    return new PostgresSchemaIntrospector(connection);
}
