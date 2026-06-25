import type { EntityMetadata } from '../model/entity-metadata';
import type { QueryModel } from '../query/query-model';
import { postgresDialect, type SqlDialect } from './sql-dialect';
import {
    groupKeyProjectionShape,
    groupKeyShape,
    havingPredicateShape,
} from './select/cache-key-aggregate';
import { predicateShape } from './select/cache-key-predicate';
import { projectionShape } from './select/cache-key-projection';
import { relationExistenceShape } from './select/cache-key-relation';

/**
 * Serializes a query's *shape* into the string that keys the compiled-SQL
 * cache. Held apart from the builders because it must stay stable in a way the
 * builders do not: two queries that differ only in their bound values share a
 * cache entry, so every function here records structure (operators, aliases,
 * property names, array vs. scalar) and never a concrete value. Any drift
 * between a query's shape here and the SQL the builder emits would serve stale
 * SQL, so these functions are moved verbatim and changed only in lockstep with
 * the builders.
 */
export function buildSelectSqlCacheKey<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    query: QueryModel<TEntity>,
    dialect: SqlDialect = postgresDialect,
): string {
    return JSON.stringify({
        dialect: dialect.name,
        entity: {
            name: metadata.entityName,
            schema: metadata.schemaName,
            table: metadata.tableName,
            columns: metadata.properties.map(property => property.columnName),
        },
        predicate: query.predicate ? predicateShape(query.predicate.node) : undefined,
        orderings: query.orderings.map(ordering => ({
            sourceAlias: ordering.sourceAlias,
            propertyName: ordering.propertyName,
            direction: ordering.direction,
        })),
        joins: query.joins.map(join => ({
            alias: join.alias,
            entityName: join.metadata.entityName,
            schema: join.metadata.schemaName,
            table: join.metadata.tableName,
            kind: join.kind,
            predicate: predicateShape(join.predicate.node),
        })),
        relationExistence: query.relationExistence.map(relationExistenceShape),
        includes: query.includes.map(include => ({
            navigationPath: include.navigationPath,
            filter: include.filter
                ? {
                    predicate: include.filter.predicate ? predicateShape(include.filter.predicate.node) : undefined,
                    orderings: include.filter.orderings.map(ordering => ({
                        propertyName: ordering.propertyName,
                        direction: ordering.direction,
                    })),
                    hasOffset: include.filter.offset !== undefined,
                    hasLimit: include.filter.limit !== undefined,
                }
                : undefined,
        })),
        projection: query.projection?.map(projection => projectionShape(projection)),
        groupKeys: query.groupKeys?.map(groupKey => groupKeyShape(groupKey)),
        groupKeyProjection: query.groupKeyProjection?.map(groupKey => groupKeyProjectionShape(groupKey)),
        aggregateProjection: query.aggregateProjection?.map(aggregate => ({
            alias: aggregate.alias,
            function: aggregate.function,
            sourceAlias: aggregate.sourceAlias,
            propertyName: aggregate.propertyName,
        })),
        having: query.having ? havingPredicateShape(query.having.node) : undefined,
        aggregateOrderings: query.aggregateOrderings?.map(ordering => ({
            operand: ordering.operand,
            direction: ordering.direction,
        })),
        hasOffset: query.offset !== undefined,
        hasLimit: query.limit !== undefined,
        ignoresQueryFilters: Boolean(query.ignoreQueryFilters),
        ignoresTenantScope: Boolean(query.ignoreTenantScope),
    });
}
