import type { EntityConstructor } from '../types';
import type { DbSetContext } from './db-set-context';
import type { EntityMetadata } from '../model/entity-metadata';
import type { RelationExistenceMetadata } from '../query/relation-expression';
import { RelationshipCardinality } from '../model/relationship-metadata';

/**
 * Resolves a navigation-property name to the relationship metadata a
 * `whereHas`/`whereDoesNotHave` predicate needs.
 *
 * This is a pure walk over the model metadata — many-to-one, many-to-many, its
 * inverse, and one-to-many — with no SQL and no context state beyond the model.
 * It is the largest single branch in the old `DbSet`, so it lives on its own
 * where it can be read (and extended with new relation kinds) in isolation.
 */
export class DbSetRelationResolver<TEntity extends object> {
    constructor(
        private readonly context: DbSetContext,
        private readonly entityType: EntityConstructor<TEntity>,
    ) {}

    private get metadata(): EntityMetadata<TEntity> {
        return this.context.modelMetadata.getEntity(this.entityType);
    }

    public resolve(navigationProperty: string): RelationExistenceMetadata {
        const sourceMetadata = this.metadata as unknown as EntityMetadata;

        const manyToOne = sourceMetadata.relationships.find(relationship => relationship.navigationProperty === navigationProperty);
        if (manyToOne) {
            return {
                kind: 'manyToOne',
                navigationProperty,
                sourceMetadata,
                targetMetadata: this.context.modelMetadata.getEntity(manyToOne.principalEntity),
                relationship: manyToOne,
            };
        }

        const manyToMany = sourceMetadata.manyToManyRelationships.find(relationship => relationship.navigationProperty === navigationProperty);
        if (manyToMany) {
            return {
                kind: 'manyToMany',
                navigationProperty,
                sourceMetadata,
                targetMetadata: this.context.modelMetadata.getEntity(manyToMany.targetEntity),
                manyToManyRelationship: manyToMany,
            };
        }

        for (const declaringMetadata of this.context.modelMetadata.entities) {
            const inverseManyToMany = declaringMetadata.manyToManyRelationships.find(relationship =>
                relationship.targetEntity === sourceMetadata.ctor &&
        (relationship.inverseNavigationProperty as unknown) === navigationProperty,
            );
            if (inverseManyToMany) {
                return {
                    kind: 'manyToMany',
                    navigationProperty,
                    sourceMetadata,
                    targetMetadata: declaringMetadata,
                    manyToManyRelationship: inverseManyToMany,
                };
            }
        }

        for (const dependentMetadata of this.context.modelMetadata.entities) {
            const oneToMany = dependentMetadata.relationships.find(relationship =>
                relationship.principalEntity === sourceMetadata.ctor &&
        (relationship.inverseNavigationProperty as unknown) === navigationProperty,
            );
            if (oneToMany) {
                return {
                    kind:
            oneToMany.cardinality === RelationshipCardinality.OneToOne
                ? 'oneToOne'
                : 'oneToMany',
                    navigationProperty,
                    sourceMetadata,
                    targetMetadata: dependentMetadata,
                    relationship: oneToMany,
                };
            }
        }

        throw new Error(`Relation '${navigationProperty}' is not configured on entity '${sourceMetadata.entityName}'.`);
    }
}
