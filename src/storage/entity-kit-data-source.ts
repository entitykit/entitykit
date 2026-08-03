import type { DatabaseConnection } from './database-connection';
import type { DatabaseConnectionSource } from './database-data-source';
import type {
    DatabaseProviderConnectionConfig,
    DatabaseProviderServices,
} from './database-provider-services';
import { DataSourceConnectionLease } from './data-source-connection-lease';
import {
    abortableDelay,
    type RetryAttempt,
    type RetryExecutionOptions,
    resolveRetryPolicy,
    retryDelayMs,
} from './data-source-retry';
import { validateProviderServices } from './database-provider-validation';
import { throwIfOperationAborted } from './operation-cancellation';
import type {
    EntityKitContextFactory,
    EntityKitDataSource,
    EntityKitDataSourceOptions,
} from './entity-kit-data-source-types';
import { isTransactionOutcomeUnknown } from './transaction-outcome';

export type {
    EntityKitContextFactory,
    EntityKitDataSource,
    EntityKitDataSourceOptions,
} from './entity-kit-data-source-types';

class EntityKitDataSourceImplementation<
    TConfig extends object = Record<string, unknown>,
> implements EntityKitDataSource<TConfig> {
    public readonly providerName: string;
    public readonly dialect;
    public readonly migrationDialect;
    public readonly createMigrationBuilder;
    public readonly valueReader;
    private readonly source: DatabaseConnectionSource;
    private readonly retryPolicy;
    private activeLeases = 0;
    private activeOperations = 0;
    private disposed = false;
    private disposePromise?: Promise<void>;

    constructor(
        provider: DatabaseProviderServices<TConfig>,
        config: DatabaseProviderConnectionConfig<TConfig>,
        options: EntityKitDataSourceOptions = {},
    ) {
        validateProviderServices(provider);
        this.providerName = provider.name;
        this.dialect = provider.dialect;
        this.migrationDialect = provider.migrationDialect;
        this.createMigrationBuilder = provider.createMigrationBuilder;
        this.valueReader = provider.valueReader;
        const providerClassifier = provider.isTransientError
            ? (error: unknown): boolean => provider.isTransientError?.(error) ?? false
            : undefined;
        this.retryPolicy = resolveRetryPolicy(options.retry, providerClassifier);
        this.source = provider.createDataSource?.(config) ?? {
            createConnection: () => provider.createConnection(config),
        };
    }

    public createConnection(): DatabaseConnection {
        this.assertActive();
        const connection = this.source.createConnection();
        this.activeLeases += 1;
        return new DataSourceConnectionLease(connection, () => {
            this.activeLeases -= 1;
        });
    }

    public createContext<
        TArguments extends unknown[],
        TFactory extends EntityKitContextFactory<TConfig, object, TArguments>,
    >(
        contextType: TFactory,
        ...arguments_: TArguments
    ): TFactory['prototype'] {
        this.assertActive();
        return contextType.create(this, ...arguments_);
    }

    public async executeWithRetry<TResult>(
        operation: (attempt: RetryAttempt) => TResult | Promise<TResult>,
        options: RetryExecutionOptions = {},
    ): Promise<TResult> {
        this.assertActive();
        this.activeOperations += 1;
        try {
            for (let attempt = 1; attempt <= this.retryPolicy.maxAttempts; attempt += 1) {
                this.assertActive();
                throwIfOperationAborted(options.signal);
                try {
                    return await operation({ attempt, maxAttempts: this.retryPolicy.maxAttempts });
                } catch (error) {
                    if (
                        isTransactionOutcomeUnknown(error) ||
                        attempt === this.retryPolicy.maxAttempts
                        || !this.retryPolicy.shouldRetry(error)
                    ) {
                        throw error;
                    }
                    await abortableDelay(retryDelayMs(this.retryPolicy, attempt), options.signal);
                }
            }
            throw new Error('EntityKit retry loop completed without a result.');
        } finally {
            this.activeOperations -= 1;
        }
    }

    public async dispose(): Promise<void> {
        if (this.disposePromise) {
            await this.disposePromise;
            return;
        }
        if (this.activeLeases > 0 || this.activeOperations > 0) {
            throw new Error(
                'Cannot dispose EntityKitDataSource while ' +
                `${String(this.activeLeases)} connection lease(s) and ` +
                `${String(this.activeOperations)} retry operation(s) are active. ` +
                'Dispose their DbContexts and await retry operations first.',
            );
        }
        this.disposed = true;
        this.disposePromise = this.source.dispose?.() ?? Promise.resolve();
        await this.disposePromise;
    }

    private assertActive(): void {
        if (this.disposed) {
            throw new Error('EntityKitDataSource was disposed.');
        }
    }
}

/** Create an application-scoped data source for a custom provider. */
export function createEntityKitDataSource<TConfig extends object = Record<string, unknown>>(
    provider: DatabaseProviderServices<TConfig>,
    config: DatabaseProviderConnectionConfig<TConfig>,
    options: EntityKitDataSourceOptions = {},
): EntityKitDataSource<TConfig> {
    return new EntityKitDataSourceImplementation(provider, config, options);
}
