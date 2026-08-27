import type { DbContext, EntityKitDataSource } from '@entitykit/core';

/** A `DbContext` class that accepts its application data source first. */
export interface EntityKitContextType<
    TContext extends DbContext = DbContext,
    TArguments extends unknown[] = never[],
> {
    /** Construct a context with its application data source first. */
    new (
        dataSource: EntityKitDataSource,
        ...arguments_: TArguments
    ): TContext;
    /** The context prototype used for token identity and type inference. */
    readonly prototype: TContext;
    /** Create and initialize one short-lived context. */
    create(
        dataSource: EntityKitDataSource,
        ...arguments_: TArguments
    ): TContext;
}
