import type { EntityConstructor, EntityPropertyKey } from '../types';
import type { DeleteBehavior } from './relationship-metadata';

export interface ManyToManyMetadata<TEntity extends object = object, TTarget extends object = object> {
    readonly navigationProperty: EntityPropertyKey<TEntity>;
    readonly targetEntity: EntityConstructor<TTarget>;
    readonly inverseNavigationProperty?: EntityPropertyKey<TTarget>;
    readonly joinTableName: string;
    readonly joinSchemaName?: string;
    readonly primaryKeyName?: string;
    /**
   * Legacy single-column fields, present only when that side's key has one
   * column. Optional so a consumer that has not been taught about composite
   * keys fails to compile rather than silently using a partial key.
   */
    readonly sourceForeignKeyColumn?: string;
    readonly targetForeignKeyColumn?: string;
    /** Join-table columns referencing the source key, in its key order. */
    readonly sourceForeignKeyColumns: readonly string[];
    /** Join-table columns referencing the target key, in its key order. */
    readonly targetForeignKeyColumns: readonly string[];
    readonly sourceConstraintName?: string;
    readonly targetConstraintName?: string;
    readonly deleteBehavior: DeleteBehavior;
}

export interface MutableManyToManyMetadata<TEntity extends object = object, TTarget extends object = object> {
    navigationProperty: EntityPropertyKey<TEntity>;
    targetEntity: EntityConstructor<TTarget>;
    inverseNavigationProperty?: EntityPropertyKey<TTarget>;
    joinTableName?: string;
    joinSchemaName?: string;
    primaryKeyName?: string;
    sourceForeignKeyColumn?: string;
    targetForeignKeyColumn?: string;
    sourceForeignKeyColumns?: readonly string[];
    targetForeignKeyColumns?: readonly string[];
    sourceConstraintName?: string;
    targetConstraintName?: string;
    deleteBehavior?: DeleteBehavior;
}
