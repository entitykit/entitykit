import type { EntityPropertyKey } from '../types';

export interface AuditMetadata<TEntity extends object = object> {
    readonly createdAtProperty?: EntityPropertyKey<TEntity>;
    readonly updatedAtProperty?: EntityPropertyKey<TEntity>;
    readonly createdByProperty?: EntityPropertyKey<TEntity>;
    readonly updatedByProperty?: EntityPropertyKey<TEntity>;
}

export interface MutableAuditMetadata<TEntity extends object = object> {
    createdAtProperty?: EntityPropertyKey<TEntity>;
    updatedAtProperty?: EntityPropertyKey<TEntity>;
    createdByProperty?: EntityPropertyKey<TEntity>;
    updatedByProperty?: EntityPropertyKey<TEntity>;
}

export interface SoftDeleteMetadata<TEntity extends object = object> {
    readonly propertyName: EntityPropertyKey<TEntity>;
    readonly deletedValue?: unknown;
}

export interface MutableSoftDeleteMetadata<TEntity extends object = object> {
    propertyName?: EntityPropertyKey<TEntity>;
    deletedValue?: unknown;
    usesTimestampConvention?: boolean;
}
