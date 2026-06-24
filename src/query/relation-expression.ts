import type { EntityPropertyKey } from '../types';
import type { EntityMetadata } from '../model/entity-metadata';
import type { ManyToManyMetadata } from '../model/many-to-many-metadata';
import type { RelationshipMetadata } from '../model/relationship-metadata';
import type { PredicateExpression } from './expression/predicate-expression';
import type { QueryProxy } from './expression/query-field';
import type { NavigationElement } from './include-expression';

declare const relationNavigationType: unique symbol;

export type RelationExistenceOperator = 'exists' | 'notExists';
export type RelationExistenceKind =
    'manyToOne' | 'oneToOne' | 'oneToMany' | 'manyToMany';

export interface RelationExistenceMetadata {
    readonly kind: RelationExistenceKind;
    readonly navigationProperty: string;
    readonly sourceMetadata: EntityMetadata;
    readonly targetMetadata: EntityMetadata;
    readonly relationship?: RelationshipMetadata;
    readonly manyToManyRelationship?: ManyToManyMetadata;
}

export interface RelationExistenceExpression {
    readonly operator: RelationExistenceOperator;
    readonly navigationProperty: string;
    readonly relation: RelationExistenceMetadata;
    readonly predicate?: PredicateExpression;
}

export type RelationNavigationProxy<TEntity extends object> = {
    readonly [K in EntityPropertyKey<TEntity>]: RelationNavigationExpression<TEntity, TEntity[K]>;
};

export class RelationNavigationExpression<TEntity extends object, TNavigation = unknown> {
    private declare readonly [relationNavigationType]?: TNavigation;

    constructor(public readonly navigationProperty: EntityPropertyKey<TEntity>) {}
}

export type RelationPredicateSelector<TNavigation> = (
    entity: QueryProxy<NavigationElement<TNavigation>>,
) => PredicateExpression;

export function createRelationNavigationProxy<TEntity extends object>(): RelationNavigationProxy<TEntity> {
    return new Proxy(Object.create(null), {
        get(_target, propertyKey): RelationNavigationExpression<TEntity> {
            if (typeof propertyKey !== 'string') {
                throw new Error('Relation selectors must access a string property.');
            }

            return new RelationNavigationExpression<TEntity, unknown>(propertyKey as EntityPropertyKey<TEntity>);
        },
    }) as RelationNavigationProxy<TEntity>;
}

export function assertRelationNavigationExpression<TEntity extends object>(
    value: unknown,
    operation: string,
): asserts value is RelationNavigationExpression<TEntity> {
    if (!(value instanceof RelationNavigationExpression)) {
        throw new Error(`${operation} selectors must return a direct navigation property access, such as 'entity => entity.posts'.`);
    }
}

export function cloneRelationExistence(expression: RelationExistenceExpression): RelationExistenceExpression {
    return {
        operator: expression.operator,
        navigationProperty: expression.navigationProperty,
        relation: expression.relation,
        predicate: expression.predicate,
    };
}
