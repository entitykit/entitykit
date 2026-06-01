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
    /** Perform the with many operation. */ withMany<TProperty = unknown>(
        selector?: PropertySelector<TPrincipal, TProperty>,
    ): this;
    /** Perform the with one operation. */ withOne<TProperty = unknown>(
        selector?: PropertySelector<TPrincipal, TProperty>,
    ): this;
    /** Configure foreign key and return this builder. */ hasForeignKey(
        propertyOrSelector:
        EntityPropertyKey<TEntity> | PropertyListSelector<TEntity>,
    ): this;
    /** Configure principal key and return this builder. */ hasPrincipalKey(
        propertyOrSelector:
        EntityPropertyKey<TPrincipal> | PropertyListSelector<TPrincipal>,
    ): this;
    /** Perform the on delete operation. */ onDelete(deleteBehavior: DeleteBehavior): this;
    /** Configure constraint name and return this builder. */ hasConstraintName(constraintName: string): this;
}

/** Configures the join table used by a many-to-many relationship. */
export interface ManyToManyJoinTableBuilder {
    /** Configure schema and return this builder. */ hasSchema(schemaName: string): this;
    /** Perform the primary key name operation. */ primaryKeyName(name: string): this;
    /** Perform the source foreign key operation. */ sourceForeignKey(columnNames: string | readonly string[]): this;
    /** Perform the target foreign key operation. */ targetForeignKey(columnNames: string | readonly string[]): this;
    /** Perform the source constraint name operation. */ sourceConstraintName(name: string): this;
    /** Perform the target constraint name operation. */ targetConstraintName(name: string): this;
}

/** Configures a many-to-many relationship between two entity types. */
export interface ManyToManyRelationshipBuilder<TTarget extends object> {
    /** Perform the with many operation. */ withMany<TInverse>(selector: PropertySelector<TTarget, TInverse>): this;
    /** Perform the using join table operation. */ usingJoinTable(
        tableName: string,
        configure?: (join: ManyToManyJoinTableBuilder) => void,
    ): this;
    /** Perform the on delete operation. */ onDelete(deleteBehavior: DeleteBehavior): this;
}
