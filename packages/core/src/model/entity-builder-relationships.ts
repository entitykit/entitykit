import type { EntityConstructor, EntityPropertyKey } from '../types';
import type { PropertySelector } from './model-property-selector';
import { selectPropertyName } from './model-property-selector';
import { RelationshipBuilderImplementation } from './relationship-builder';
import { ManyToManyRelationshipBuilderImplementation } from './many-to-many-relationship-builder';
import type {
    ManyToManyRelationshipBuilder,
    RelationshipBuilder,
} from './relationship-builder-types';
import {
    DeleteBehavior,
    RelationshipCardinality,
    type MutableRelationshipMetadata,
    type RelationshipMetadata,
} from './relationship-metadata';
import type { ManyToManyMetadata, MutableManyToManyMetadata } from './many-to-many-metadata';
import type { PropertyMetadata } from './property-metadata';

/**
 * Relationship-configuration facet.
 *
 * WHY separate: references (`hasOne`) and join-table collections
 * (`hasManyToMany`) carry their own foreign-key wiring and delete-behavior
 * defaults (`NoAction` for references, `Cascade` for collections), and their
 * finalization is a distinct rule set — foreign keys must resolve to configured
 * properties, single-column keys keep a legacy scalar field, and the source
 * foreign-key arity must match the entity key. None of that overlaps property
 * or key mapping, so it lives on its own; the key arity it needs is passed in
 * at finalize time rather than duplicated here.
 */
export class EntityBuilderRelationships<TEntity extends object> {
    private readonly relationships: Array<MutableRelationshipMetadata<TEntity>> = [];
    private readonly manyToManyRelationships: Array<MutableManyToManyMetadata<TEntity>> = [];

    constructor(private readonly ctor: EntityConstructor<TEntity>) {}

    public hasOne<TPrincipal extends object, TNavigation>(
        principalEntity: EntityConstructor<TPrincipal>,
        navigationSelector: PropertySelector<TEntity, TNavigation>,
    ): RelationshipBuilder<TEntity, TPrincipal> {
        const relationship: MutableRelationshipMetadata<TEntity, TPrincipal> = {
            principalEntity,
            navigationProperty: selectPropertyName(navigationSelector),
            deleteBehavior: DeleteBehavior.NoAction,
        };
        this.relationships.push(relationship as unknown as MutableRelationshipMetadata<TEntity>);
        return new RelationshipBuilderImplementation(relationship);
    }

    public hasManyToMany<TTarget extends object, TNavigation>(
        targetEntity: EntityConstructor<TTarget>,
        navigationSelector: PropertySelector<TEntity, TNavigation>,
    ): ManyToManyRelationshipBuilder<TTarget> {
        const relationship: MutableManyToManyMetadata<TEntity, TTarget> = {
            targetEntity,
            navigationProperty: selectPropertyName(navigationSelector),
            deleteBehavior: DeleteBehavior.Cascade,
        };
        this.manyToManyRelationships.push(relationship as unknown as MutableManyToManyMetadata<TEntity>);
        return new ManyToManyRelationshipBuilderImplementation(relationship);
    }

    public finalizeRelationships(properties: ReadonlyArray<PropertyMetadata<TEntity>>): Array<RelationshipMetadata<TEntity>> {
        const propertyNames = new Set(properties.map(property => property.propertyName));
        return this.relationships.map(relationship => {
            const foreignKeyProperties = relationship.foreignKeyProperties
        ?? (relationship.foreignKeyProperty ? [relationship.foreignKeyProperty] : undefined);
            if (!foreignKeyProperties || foreignKeyProperties.length === 0) {
                throw new Error(`Relationship '${relationship.navigationProperty}' on entity '${this.ctor.name}' must configure a foreign key.`);
            }

            for (const foreignKeyProperty of foreignKeyProperties) {
                if (!propertyNames.has(foreignKeyProperty)) {
                    throw new Error(`Relationship '${relationship.navigationProperty}' on entity '${this.ctor.name}' references unconfigured foreign key '${foreignKeyProperty}'.`);
                }
            }

            return {
                principalEntity: relationship.principalEntity,
                navigationProperty: relationship.navigationProperty,
                inverseNavigationProperty: relationship.inverseNavigationProperty,
                foreignKeyProperties,
                // Kept for single-column foreign keys only, so consumers that have not
                // been taught about composite keys cannot read a partial key.
                foreignKeyProperty: foreignKeyProperties.length === 1 ? foreignKeyProperties[0] : undefined,
                principalKeyProperties: relationship.principalKeyProperties
                    ? [...relationship.principalKeyProperties]
                    : undefined,
                cardinality: relationship.cardinality ??
          RelationshipCardinality.ManyToOne,
                deleteBehavior: relationship.deleteBehavior ?? DeleteBehavior.NoAction,
                constraintName: relationship.constraintName,
            } satisfies RelationshipMetadata<TEntity>;
        });
    }

    public finalizeManyToManyRelationships(
        keyProperties: ReadonlyArray<EntityPropertyKey<TEntity>> | undefined,
    ): Array<ManyToManyMetadata<TEntity>> {
        return this.manyToManyRelationships.map(relationship => {
            if (!relationship.joinTableName) {
                throw new Error(`Many-to-many relationship '${relationship.navigationProperty}' on entity '${this.ctor.name}' must configure a join table.`);
            }

            const sourceForeignKeyColumns = relationship.sourceForeignKeyColumns
        ?? (relationship.sourceForeignKeyColumn ? [relationship.sourceForeignKeyColumn] : undefined);
            const targetForeignKeyColumns = relationship.targetForeignKeyColumns
        ?? (relationship.targetForeignKeyColumn ? [relationship.targetForeignKeyColumn] : undefined);
            if (!sourceForeignKeyColumns?.length || !targetForeignKeyColumns?.length) {
                throw new Error(`Many-to-many relationship '${relationship.navigationProperty}' on entity '${this.ctor.name}' must configure source and target foreign key columns.`);
            }

            // The source side is this entity, so its key count is known here. The
            // target side is validated when the model is built, where both entities
            // are available.
            if (sourceForeignKeyColumns.length !== (keyProperties?.length ?? 1)) {
                throw new Error(
                    `Many-to-many relationship '${relationship.navigationProperty}' on entity '${this.ctor.name}' declares ${String(sourceForeignKeyColumns.length)} source foreign key column(s), but the entity key has ${String(keyProperties?.length ?? 1)}.`,
                );
            }

            return {
                targetEntity: relationship.targetEntity,
                navigationProperty: relationship.navigationProperty,
                inverseNavigationProperty: relationship.inverseNavigationProperty,
                joinTableName: relationship.joinTableName,
                joinSchemaName: relationship.joinSchemaName,
                primaryKeyName: relationship.primaryKeyName,
                sourceForeignKeyColumns,
                targetForeignKeyColumns,
                sourceForeignKeyColumn: sourceForeignKeyColumns.length === 1 ? sourceForeignKeyColumns[0] : undefined,
                targetForeignKeyColumn: targetForeignKeyColumns.length === 1 ? targetForeignKeyColumns[0] : undefined,
                sourceConstraintName: relationship.sourceConstraintName,
                targetConstraintName: relationship.targetConstraintName,
                deleteBehavior: relationship.deleteBehavior ?? DeleteBehavior.Cascade,
            } satisfies ManyToManyMetadata<TEntity>;
        });
    }
}
