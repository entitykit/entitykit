import type { EntityConstructor, EntityPropertyKey } from '../types';
import type { EntityMetadata } from '../model/entity-metadata';
import type { AggregateExpression, AggregateOrderExpression, GroupKeyExpression, GroupKeyProjectionExpression, HavingPredicateExpression } from './aggregate';
import type { OrderExpression } from './expression/order-expression';
import type { PredicateExpression } from './expression/predicate-expression';
import type { ProjectionExpression } from './projection';
import { cloneRelationExistence, type RelationExistenceExpression } from './relation-expression';

export type JoinKind = 'inner' | 'left';
export type QueryTrackingBehavior = 'track' | 'noTracking';

export interface JoinExpression {
    readonly alias: string;
    readonly metadata: EntityMetadata;
    readonly kind: JoinKind;
    readonly predicate: PredicateExpression;
}

export interface IncludeFilterModel<TEntity extends object = object> {
    readonly predicate?: PredicateExpression;
    readonly orderings: ReadonlyArray<OrderExpression<TEntity>>;
    readonly offset?: number;
    readonly limit?: number;
}

export interface IncludeExpression<TEntity extends object = object> {
    readonly navigationProperty: EntityPropertyKey<TEntity>;
    readonly navigationPath: readonly string[];
    readonly filter?: IncludeFilterModel;
}

export interface QueryModel<TEntity extends object = object> {
    readonly entityType: EntityConstructor<TEntity>;
    readonly predicate?: PredicateExpression;
    readonly orderings: ReadonlyArray<OrderExpression<TEntity>>;
    readonly includes: ReadonlyArray<IncludeExpression<TEntity>>;
    readonly joins: readonly JoinExpression[];
    readonly relationExistence: readonly RelationExistenceExpression[];
    readonly projection?: readonly ProjectionExpression[];
    readonly groupKeys?: readonly GroupKeyExpression[];
    readonly groupKeyProjection?: readonly GroupKeyProjectionExpression[];
    readonly aggregateProjection?: readonly AggregateExpression[];
    readonly having?: HavingPredicateExpression;
    readonly aggregateOrderings?: readonly AggregateOrderExpression[];
    readonly offset?: number;
    readonly limit?: number;
    readonly ignoreQueryFilters?: boolean;
    readonly ignoreTenantScope?: boolean;
    readonly trackingBehavior?: QueryTrackingBehavior;
}

export function createQueryModel<TEntity extends object>(
    entityType: EntityConstructor<TEntity>,
): QueryModel<TEntity> {
    return {
        entityType,
        orderings: [],
        includes: [],
        joins: [],
        relationExistence: [],
        ignoreQueryFilters: false,
        ignoreTenantScope: false,
        trackingBehavior: 'track',
    };
}

export function cloneQueryModel<TEntity extends object>(
    model: QueryModel<TEntity>,
    changes: Partial<Omit<QueryModel<TEntity>, 'entityType'>>,
): QueryModel<TEntity> {
    return {
        entityType: model.entityType,
        predicate: changes.predicate ?? model.predicate,
        orderings: changes.orderings ?? [...model.orderings],
        includes: changes.includes ?? model.includes.map(include => cloneInclude(include)),
        joins: changes.joins ?? model.joins.map(join => cloneJoin(join)),
        relationExistence: changes.relationExistence ?? model.relationExistence.map(expression => cloneRelationExistence(expression)),
        projection: changes.projection ?? (model.projection ? [...model.projection] : undefined),
        groupKeys: changes.groupKeys ?? (model.groupKeys ? [...model.groupKeys] : undefined),
        groupKeyProjection: changes.groupKeyProjection ?? (model.groupKeyProjection ? [...model.groupKeyProjection] : undefined),
        aggregateProjection: changes.aggregateProjection ?? (model.aggregateProjection ? [...model.aggregateProjection] : undefined),
        having: changes.having ?? model.having,
        aggregateOrderings: changes.aggregateOrderings ?? (model.aggregateOrderings ? [...model.aggregateOrderings] : undefined),
        offset: changes.offset ?? model.offset,
        limit: changes.limit ?? model.limit,
        ignoreQueryFilters: changes.ignoreQueryFilters ?? model.ignoreQueryFilters,
        ignoreTenantScope: changes.ignoreTenantScope ?? model.ignoreTenantScope,
        trackingBehavior: changes.trackingBehavior ?? model.trackingBehavior,
    };
}

export function cloneJoin(join: JoinExpression): JoinExpression {
    return {
        alias: join.alias,
        metadata: join.metadata,
        kind: join.kind,
        predicate: join.predicate,
    };
}

export function cloneInclude<TEntity extends object>(include: IncludeExpression<TEntity>): IncludeExpression<TEntity> {
    return {
        navigationProperty: include.navigationProperty,
        navigationPath: [...include.navigationPath],
        filter: include.filter ? cloneIncludeFilter(include.filter) : undefined,
    };
}

export function cloneIncludeFilter<TEntity extends object>(filter: IncludeFilterModel<TEntity>): IncludeFilterModel<TEntity> {
    return {
        predicate: filter.predicate,
        orderings: [...filter.orderings],
        offset: filter.offset,
        limit: filter.limit,
    };
}
