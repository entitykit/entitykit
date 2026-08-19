import type { EntityPropertyKey } from '../types';

export type IndexKeyPart<TEntity extends object = object> =
    | { readonly kind: 'property'; readonly propertyName: EntityPropertyKey<TEntity> }
    | { readonly kind: 'expression'; readonly expression: string };

export interface IndexMetadata<TEntity extends object = object> {
    /** Legacy convenience list containing property key parts only. */
    readonly propertyNames: ReadonlyArray<EntityPropertyKey<TEntity>>;
    /** Ordered key terms, including raw SQL expression terms. */
    readonly keyParts?: ReadonlyArray<IndexKeyPart<TEntity>>;
    readonly includedPropertyNames?: ReadonlyArray<EntityPropertyKey<TEntity>>;
    readonly filter?: string;
    readonly isUnique: boolean;
    readonly databaseName?: string;
}

export interface MutableIndexMetadata<TEntity extends object = object> {
    propertyNames: Array<EntityPropertyKey<TEntity>>;
    keyParts?: Array<IndexKeyPart<TEntity>>;
    includedPropertyNames?: Array<EntityPropertyKey<TEntity>>;
    filter?: string;
    isUnique?: boolean;
    databaseName?: string;
}
