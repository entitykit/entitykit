import type { EntityConstructor, EntityPropertyKey } from '../types';

/** Supported values for delete behavior. */ export enum DeleteBehavior {
    /** Select the restrict behavior. */ Restrict = 'restrict',
    /** Select the cascade behavior. */ Cascade = 'cascade',
    /** Select the set null behavior. */ SetNull = 'set null',
    /** Select the no action behavior. */ NoAction = 'no action',
}

/** Supported values for relationship cardinality. */ export enum RelationshipCardinality {
    /** Select the many to one behavior. */ ManyToOne = 'manyToOne',
    /** Select the one to one behavior. */ OneToOne = 'oneToOne',
}

export interface RelationshipMetadata<TEntity extends object = object, TPrincipal extends object = object> {
    readonly navigationProperty: EntityPropertyKey<TEntity>;
    readonly principalEntity: EntityConstructor<TPrincipal>;
    readonly inverseNavigationProperty?: EntityPropertyKey<TPrincipal>;
    /**
   * Legacy single-column field, present only when the foreign key has one
   * column. Optional so that a consumer which has not been taught about
   * multi-column foreign keys fails to compile rather than silently using a
   * partial key.
   */
    readonly foreignKeyProperty?: EntityPropertyKey<TEntity>;
    /**
   * Foreign key properties, in the order of the principal's key properties.
   */
    readonly foreignKeyProperties: ReadonlyArray<EntityPropertyKey<TEntity>>;
    /**
     * Principal properties in relationship order. Absent means primary key.
     */
    readonly principalKeyProperties?: ReadonlyArray<EntityPropertyKey<TPrincipal>>;
    readonly cardinality: RelationshipCardinality;
    readonly deleteBehavior: DeleteBehavior;
    readonly constraintName?: string;
}

export interface MutableRelationshipMetadata<TEntity extends object = object, TPrincipal extends object = object> {
    navigationProperty: EntityPropertyKey<TEntity>;
    principalEntity: EntityConstructor<TPrincipal>;
    inverseNavigationProperty?: EntityPropertyKey<TPrincipal>;
    foreignKeyProperty?: EntityPropertyKey<TEntity>;
    foreignKeyProperties?: ReadonlyArray<EntityPropertyKey<TEntity>>;
    principalKeyProperties?: ReadonlyArray<EntityPropertyKey<TPrincipal>>;
    cardinality?: RelationshipCardinality;
    deleteBehavior?: DeleteBehavior;
    constraintName?: string;
}
