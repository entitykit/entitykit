import type { EntityPropertyKey } from '../types';
import type {
    PropertyListSelector,
    PropertySelector,
} from './model-property-selector';
import type { DeleteBehavior } from './relationship-metadata';

/** Configures a reference relationship between two entity types. */
export interface RelationshipBuilder<
    TEntity extends object,
    TPrincipal extends object,
> {
    /** Configure a collection on the other side of this relationship. */ withMany<TProperty = unknown>(
        selector?: PropertySelector<TPrincipal, TProperty>,
    ): this;
    /** Configure a reference on the other side of this relationship. */ withOne<TProperty = unknown>(
        selector?: PropertySelector<TPrincipal, TProperty>,
    ): this;
    /** Select the dependent properties that store the foreign key. */ hasForeignKey(
        propertyOrSelector:
        EntityPropertyKey<TEntity> | PropertyListSelector<TEntity>,
    ): this;
    /** Select the primary or alternate key referenced on the principal. */ hasPrincipalKey(
        propertyOrSelector:
        EntityPropertyKey<TPrincipal> | PropertyListSelector<TPrincipal>,
    ): this;
    /** Configure relationship deletion behavior in the model. Executes no SQL. */ onDelete(deleteBehavior: DeleteBehavior): this;
    /** Name the database foreign-key constraint. */ hasConstraintName(constraintName: string): this;
}

/** Configures the join table used by a many-to-many relationship. */
export interface ManyToManyJoinTableBuilder {
    /** Select the database schema for the join table. */ hasSchema(schemaName: string): this;
    /** Name the join table primary-key constraint. */ primaryKeyName(name: string): this;
    /** Name the join columns referencing the source key, in key order. */ sourceForeignKey(columnNames: string | readonly string[]): this;
    /** Name the join columns referencing the target key, in key order. */ targetForeignKey(columnNames: string | readonly string[]): this;
    /** Name the join table foreign-key constraint referencing the source. */ sourceConstraintName(name: string): this;
    /** Name the join table foreign-key constraint referencing the target. */ targetConstraintName(name: string): this;
}

/** Configures a many-to-many relationship between two entity types. */
export interface ManyToManyRelationshipBuilder<TTarget extends object> {
    /** Configure a collection on the other side of this relationship. */ withMany<TInverse>(selector: PropertySelector<TTarget, TInverse>): this;
    /** Map the relationship to a join table and optionally configure its columns and constraints. */ usingJoinTable(
        tableName: string,
        configure?: (join: ManyToManyJoinTableBuilder) => void,
    ): this;
    /** Configure relationship deletion behavior in the model. Executes no SQL. */ onDelete(deleteBehavior: DeleteBehavior): this;
}
