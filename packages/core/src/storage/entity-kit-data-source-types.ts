import type { RetryAttempt, RetryExecutionOptions, RetryPolicyOptions } from './data-source-retry';
import type { DatabaseDataSource } from './database-data-source';

/** Retry policy for an application-scoped EntityKit data source. */
export interface EntityKitDataSourceOptions {
    /** Retry transient failures at the application data-source boundary. */
    readonly retry?: RetryPolicyOptions;
}

/** Static context factory accepted by `EntityKitDataSource.createContext()`. */
export interface EntityKitContextFactory<
    TConfig extends object,
    TContext extends object,
    TArguments extends unknown[],
> {
    /** The constructor establishes the context type and arguments after the source. */
    new (dataSource: EntityKitDataSource<TConfig>, ...arguments_: TArguments): TContext;
    /** Runtime prototype used to identify the context class. */
    readonly prototype: TContext;
    /** Create and synchronously initialize one context from the shared source. */
    create(
        dataSource: EntityKitDataSource<TConfig>,
        ...arguments_: NoInfer<TArguments>
    ): NoInfer<TContext>;
}

/**
 * Application-scoped provider resources shared by short-lived `DbContext`s.
 *
 * Create one source for a server process or warm serverless instance. Dispose
 * every context before disposing the source during application shutdown.
 */
export interface EntityKitDataSource<
    TConfig extends object = Record<string, unknown>,
> extends DatabaseDataSource {
    /** Create one initialized context; the caller owns and must dispose it. */
    createContext<
        TContext extends object,
        TArguments extends unknown[],
    >(
        contextType: EntityKitContextFactory<TConfig, TContext, TArguments>,
        ...arguments_: NoInfer<TArguments>
    ): TContext;
    /** Execute retry-safe work; the callback may run more than once. */
    executeWithRetry<TResult>(
        operation: (attempt: RetryAttempt) => TResult | Promise<TResult>,
        options?: RetryExecutionOptions,
    ): Promise<TResult>;
    /** Close provider resources after every context and retry operation ends. */
    dispose(): Promise<void>;
}
