import type { EntityPropertyKey } from '../types';

/** A declared unique tuple that relationships may target instead of the primary key. */
export interface AlternateKeyMetadata<TEntity extends object = object> {
    readonly propertyNames: ReadonlyArray<EntityPropertyKey<TEntity>>;
    readonly databaseName?: string;
}

export interface MutableAlternateKeyMetadata<TEntity extends object = object> {
    propertyNames: Array<EntityPropertyKey<TEntity>>;
    databaseName?: string;
}
