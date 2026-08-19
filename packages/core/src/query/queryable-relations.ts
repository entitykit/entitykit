import type { EntityMetadata } from '../model/entity-metadata';
import type { NavigationElement } from './include-types';
import { createQueryProxy } from './query-proxy';
import type { Queryable } from './queryable';
import { QueryableFiltering } from './queryable-filtering';
import { assertPredicateExpression } from './queryable-helpers';
import {
    assertRelationNavigationExpression,
    createRelationNavigationProxy,
    type RelationExistenceExpression,
    type RelationExistenceMetadata,
    type RelationExistenceOperator,
} from './relation-expression';
import type {
    RelationNavigationExpression,
    RelationNavigationProxy,
    RelationPredicateSelector,
} from './relation-types';

export abstract class QueryableRelations<
    TEntity extends object,
> extends QueryableFiltering<TEntity> {
    public whereHas<TNavigation>(
        selector: (
            entity: RelationNavigationProxy<TEntity>,
        ) => RelationNavigationExpression<TEntity, TNavigation>,
        predicateSelector?: RelationPredicateSelector<TNavigation>,
    ): Queryable<TEntity> {
        return this.withRelationExistence(
            'exists', selector, predicateSelector,
        );
    }

    public whereDoesNotHave<TNavigation>(
        selector: (
            entity: RelationNavigationProxy<TEntity>,
        ) => RelationNavigationExpression<TEntity, TNavigation>,
        predicateSelector?: RelationPredicateSelector<TNavigation>,
    ): Queryable<TEntity> {
        return this.withRelationExistence(
            'notExists', selector, predicateSelector,
        );
    }

    private withRelationExistence<TNavigation>(
        operator: RelationExistenceOperator,
        selector: (
            entity: RelationNavigationProxy<TEntity>,
        ) => RelationNavigationExpression<TEntity, TNavigation>,
        predicateSelector?: RelationPredicateSelector<TNavigation>,
    ): Queryable<TEntity> {
        const navigation = selector(createRelationNavigationProxy<TEntity>());
        const operation = operator === 'exists'
            ? 'whereHas'
            : 'whereDoesNotHave';
        assertRelationNavigationExpression<TEntity>(navigation, operation);

        const predicate = predicateSelector
            ? predicateSelector(createQueryProxy<NavigationElement<TNavigation>>())
            : undefined;
        if (predicate !== undefined) {
            assertPredicateExpression(
                predicate,
                `${operation} predicate selectors`,
            );
        }

        const expression: RelationExistenceExpression = {
            operator,
            navigationProperty: navigation.navigationProperty,
            relation: this.resolveRelationExistence(
                navigation.navigationProperty,
            ),
            predicate,
        };
        return this.with({
            relationExistence: [...this.model.relationExistence, expression],
        });
    }

    private resolveRelationExistence(
        navigationProperty: string,
    ): RelationExistenceMetadata {
        const resolved = this.executor.resolveRelationExistence?.(
            navigationProperty,
        );
        if (resolved) {
            return resolved;
        }

        const manyToOne = this.metadata.relationships.find(
            relationship =>
                relationship.navigationProperty === navigationProperty,
        );
        if (manyToOne) {
            return {
                kind: 'manyToOne',
                navigationProperty,
                sourceMetadata:
          this.metadata as unknown as EntityMetadata,
                targetMetadata:
          this.metadata as unknown as EntityMetadata,
                relationship: manyToOne as unknown as
          RelationExistenceMetadata['relationship'],
            };
        }

        const manyToMany = this.metadata.manyToManyRelationships.find(
            relationship =>
                relationship.navigationProperty === navigationProperty,
        );
        if (manyToMany) {
            return {
                kind: 'manyToMany',
                navigationProperty,
                sourceMetadata:
          this.metadata as unknown as EntityMetadata,
                targetMetadata:
          this.metadata as unknown as EntityMetadata,
                manyToManyRelationship: manyToMany as unknown as
          RelationExistenceMetadata['manyToManyRelationship'],
            };
        }

        throw new Error(
            `Relation '${navigationProperty}' is not configured on entity `
      + `'${this.metadata.entityName}'.`,
        );
    }
}
