import type { QueryModel } from './query-model';

/** Stable, serializable description of a query builder. */
export interface QueryPlan {
    /** Version of this serialized machine contract. */ readonly schemaVersion: 1;
    /** The entity name. */ readonly entityName: string;
    /** The tracking. */ readonly tracking: 'track' | 'noTracking';
    /** Whether predicate. */ readonly hasPredicate: boolean;
    /** The orderings. */ readonly orderings: number;
    /** The includes. */ readonly includes: readonly string[];
    /** The joins. */ readonly joins: readonly QueryPlanJoin[];
    /** The relation predicates. */ readonly relationPredicates: number;
    /** The projection fields. */ readonly projectionFields: number;
    /** The group keys. */ readonly groupKeys: number;
    /** The aggregate fields. */ readonly aggregateFields: number;
    /** Whether having. */ readonly hasHaving: boolean;
    /** The offset. */ readonly offset: number | null;
    /** The limit. */ readonly limit: number | null;
    /** The ignores query filters. */ readonly ignoresQueryFilters: boolean;
    /** The ignores tenant scope. */ readonly ignoresTenantScope: boolean;
}

/** One join in a stable query plan. */
export interface QueryPlanJoin {
    /** The alias. */ readonly alias: string;
    /** The kind. */ readonly kind: 'inner' | 'left';
    /** The entity name. */ readonly entityName: string;
}

export function createQueryPlan<TEntity extends object>(
    model: QueryModel<TEntity>,
): QueryPlan {
    return {
        schemaVersion: 1,
        entityName: model.entityType.name,
        tracking: model.trackingBehavior ?? 'track',
        hasPredicate: model.predicate !== undefined,
        orderings: model.orderings.length,
        includes: model.includes.map(include =>
            include.navigationPath.join('.')),
        joins: model.joins.map(join => ({
            alias: join.alias,
            kind: join.kind,
            entityName: join.metadata.entityName,
        })),
        relationPredicates: model.relationExistence.length,
        projectionFields: model.projection?.length ?? 0,
        groupKeys: model.groupKeys?.length ?? 0,
        aggregateFields: model.aggregateProjection?.length ?? 0,
        hasHaving: model.having !== undefined,
        offset: model.offset ?? null,
        limit: model.limit ?? null,
        ignoresQueryFilters: model.ignoreQueryFilters ?? false,
        ignoresTenantScope: model.ignoreTenantScope ?? false,
    };
}
