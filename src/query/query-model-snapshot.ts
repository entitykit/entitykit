import {
    cloneInclude,
    cloneJoin,
    type QueryModel,
} from './query-model';

/** Copy a query model for an entity-shaped builder. */
export function snapshotQueryModel<TEntity extends object>(
    model: QueryModel<TEntity>,
): QueryModel<TEntity> {
    return snapshotWithJoins(
        model,
        model.joins.map(join => ({ ...join })),
    );
}

/** Copy a joined query model while keeping only canonical join fields. */
export function snapshotJoinedQueryModel<TEntity extends object>(
    model: QueryModel<TEntity>,
): QueryModel<TEntity> {
    return snapshotWithJoins(model, model.joins.map(join => cloneJoin(join)));
}

function snapshotWithJoins<TEntity extends object>(
    model: QueryModel<TEntity>,
    joins: QueryModel<TEntity>['joins'],
): QueryModel<TEntity> {
    return {
        entityType: model.entityType,
        predicate: model.predicate,
        orderings: [...model.orderings],
        includes: model.includes.map(include => cloneInclude(include)),
        joins,
        relationExistence: model.relationExistence.map(expression => ({
            ...expression,
        })),
        projection: model.projection ? [...model.projection] : undefined,
        groupKeys: model.groupKeys ? [...model.groupKeys] : undefined,
        groupKeyProjection: model.groupKeyProjection
            ? [...model.groupKeyProjection]
            : undefined,
        aggregateProjection: model.aggregateProjection
            ? [...model.aggregateProjection]
            : undefined,
        having: model.having,
        aggregateOrderings: model.aggregateOrderings
            ? [...model.aggregateOrderings]
            : undefined,
        offset: model.offset,
        limit: model.limit,
        ignoreQueryFilters: model.ignoreQueryFilters,
        ignoreTenantScope: model.ignoreTenantScope,
        trackingBehavior: model.trackingBehavior,
    };
}
