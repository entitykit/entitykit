import type { MigrationBuilderFactory } from '../../migrations/migration-builder-contract';
import type { MigrationSqlDialect } from '../../migrations/migration-sql-dialect';
import type { SqlDialect } from '../../sql/sql-dialect';
import type { DatabaseConnection } from '../../storage/database-connection';
import type { DatabaseDataSource } from '../../storage/database-data-source';
import type {
    DatabaseProviderConnectionConfig,
    DatabaseRuntimeProviderServices,
} from '../../storage/database-provider-services';
import type { StoreValueReader } from '../../storage/store-value-reader';
import {
    validateDatabaseDataSource,
    validateProviderServices,
} from '../../storage/database-provider-validation';
import type { ProviderOptions } from './db-context-option-types';
import { assertSynchronousCallbackResult } from '../../synchronous-callback';

export interface ConfiguredProvider {
    readonly provider: ProviderOptions;
    readonly dialect: SqlDialect;
    readonly migrationDialect: MigrationSqlDialect;
    readonly createMigrationBuilder: MigrationBuilderFactory;
    readonly connection: DatabaseConnection;
    readonly ownsConnection: boolean;
    readonly valueReader?: StoreValueReader;
}

export class ProviderSelection {
    private provider?: ProviderOptions;
    private dialect?: SqlDialect;
    private migrationDialect?: MigrationSqlDialect;
    private createMigrationBuilder?: MigrationBuilderFactory;
    private connection?: DatabaseConnection;
    private connectionFactory?: () => DatabaseConnection;
    private ownsConnection = true;
    private valueReader?: StoreValueReader;

    public useProvider<TConfig extends object>(
        provider: DatabaseRuntimeProviderServices<TConfig>,
        config: DatabaseProviderConnectionConfig<TConfig>,
    ): void {
        this.assertUnconfigured();
        validateProviderServices(provider);
        assertConnectionString(provider.name, config);

        this.provider = { provider: provider.name };
        this.dialect = provider.dialect;
        this.migrationDialect = provider.migrationDialect;
        this.createMigrationBuilder = provider.createMigrationBuilder;
        this.valueReader = provider.valueReader;
        this.connectionFactory = () => provider.createConnection(config);
    }

    public useDataSource(dataSource: DatabaseDataSource): void {
        this.assertUnconfigured();
        validateDatabaseDataSource(dataSource);
        this.provider = { provider: dataSource.providerName };
        this.dialect = dataSource.dialect;
        this.migrationDialect = dataSource.migrationDialect;
        this.createMigrationBuilder = dataSource.createMigrationBuilder;
        this.valueReader = dataSource.valueReader;
        this.connectionFactory = () => dataSource.createConnection();
    }

    public useConnection(
        connection: DatabaseConnection,
        provider: ProviderOptions,
        dialect: SqlDialect,
        migrationDialect: MigrationSqlDialect,
        createMigrationBuilder: MigrationBuilderFactory,
        valueReader?: StoreValueReader,
        ownsConnection = true,
    ): void {
        this.assertUnconfigured();
        this.provider = provider;
        this.dialect = dialect;
        this.migrationDialect = migrationDialect;
        this.createMigrationBuilder = createMigrationBuilder;
        this.valueReader = valueReader;
        this.connection = connection;
        this.ownsConnection = ownsConnection;
    }

    public build(): ConfiguredProvider {
        if (
            !this.provider
      || !this.dialect
      || !this.migrationDialect
      || !this.createMigrationBuilder
        ) {
            throw new Error('DbContextOptionsBuilder must configure a database provider.');
        }
        let connection = this.connection;
        if (!connection && this.connectionFactory) {
            const created: unknown = this.connectionFactory();
            assertSynchronousCallbackResult(
                created,
                `Database provider '${this.provider.provider}' connection factory`,
                message => new TypeError(message),
            );
            connection = created as DatabaseConnection;
        }
        if (!connection) {
            throw new Error('The configured database provider did not create a connection.');
        }

        return {
            provider: this.provider,
            dialect: this.dialect,
            migrationDialect: this.migrationDialect,
            createMigrationBuilder: this.createMigrationBuilder,
            connection,
            ownsConnection: this.ownsConnection,
            valueReader: this.valueReader,
        };
    }

    private assertUnconfigured(): void {
        if (this.provider || this.connection || this.connectionFactory) {
            throw new Error(
                'DbContextOptionsBuilder already has a database configured. Choose exactly one provider, data source, or connection.',
            );
        }
    }
}

export function assertConnectionString(
    providerName: string,
    config: DatabaseProviderConnectionConfig<object>,
): void {
    if (typeof config === 'string' && config.trim().length === 0) {
        throw new Error(`${providerName} connection string must not be empty.`);
    }
}
