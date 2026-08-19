import type { RetryAttempt, RetryExecutionOptions, RetryPolicyOptions } from './data-source-retry';
import type { DatabaseDataSource } from './database-data-source';

/** Retry policy for an application-scoped EntityKit data source. */
export interface EntityKitDataSourceOptions {
    /** The retry. */ readonly retry?: RetryPolicyOptions;
}

/** Static context factory accepted by `EntityKitDataSource.createContext()`. */
export interface EntityKitContextFactory<
    TConfig extends object,
    TContext extends object,
    TArguments extends unknown[],
> {
    /** The prototype. */ readonly prototype: TContext;
    /** Create and initialize an instance. */ create(
        dataSource: EntityKitDataSource<TConfig>,
        ...arguments_: TArguments
    ): TContext;
}

/** Application-scoped provider resources and retry coordination. */
export interface EntityKitDataSource<
    TConfig extends object = Record<string, unknown>,
> extends DatabaseDataSource {
    /** Create context. */ createContext<
        TArguments extends unknown[],
        TFactory extends EntityKitContextFactory<TConfig, object, TArguments>,
    >(
        contextType: TFactory,
        ...arguments_: TArguments
    ): TFactory['prototype'];
    /** Perform the execute with retry operation. */ executeWithRetry<TResult>(
        operation: (attempt: RetryAttempt) => TResult | Promise<TResult>,
        options?: RetryExecutionOptions,
    ): Promise<TResult>;
    /** Release resources owned by this object. */ dispose(): Promise<void>;
}
