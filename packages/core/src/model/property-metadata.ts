import type { EntityPropertyKey } from '../types';
import type { ValueConverter } from './value-converter/converter';
import type { ValueGenerated } from './value-generated';
import type { StoreGenerationStrategy } from './store-generation';

export interface PropertyMetadata<TEntity extends object = object, TProperty = unknown> {
    readonly propertyName: EntityPropertyKey<TEntity> | string;
    /** Object path used to read and write this flattened mapped value. */
    readonly propertyPath: readonly string[];
    readonly columnName: string;
    readonly columnType: string;
    readonly isRequired: boolean;
    readonly isPrimaryKey: boolean;
    readonly isUnique: boolean;
    readonly maxLength?: number;
    readonly defaultValue?: unknown;
    readonly defaultSql?: string;
    /** SQL expression evaluated by the database for a generated column. */
    readonly computedSql?: string;
    /** Whether a generated column is physically stored instead of virtual. */
    readonly computedStored?: boolean;
    /** Store collation applied to this column. */
    readonly collation?: string;
    /** Database mechanism that produces values for this column. */
    readonly storeGeneration?: StoreGenerationStrategy;
    readonly converter?: ValueConverter<TProperty>;
    readonly isConcurrencyToken: boolean;
    readonly isVersion: boolean;
    readonly valueGenerated?: ValueGenerated;
}

export interface MutablePropertyMetadata<TEntity extends object = object, TProperty = unknown> {
    propertyName: EntityPropertyKey<TEntity> | string;
    propertyPath?: readonly string[];
    columnName?: string;
    columnType?: string;
    isRequired?: boolean;
    isPrimaryKey?: boolean;
    isUnique?: boolean;
    maxLength?: number;
    defaultValue?: unknown;
    defaultSql?: string;
    computedSql?: string;
    computedStored?: boolean;
    collation?: string;
    storeGeneration?: StoreGenerationStrategy;
    converter?: ValueConverter<TProperty>;
    isConcurrencyToken?: boolean;
    isVersion?: boolean;
    valueGenerated?: ValueGenerated;
}
