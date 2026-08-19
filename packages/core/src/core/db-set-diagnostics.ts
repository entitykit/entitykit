import type { EntityConstructor } from '../types';
import type { DbSetContext } from './db-set-context';
import type { EntityMetadata } from '../model/entity-metadata';
import type { QueryModel } from '../query/query-model';
import type { SqlStatement } from '../sql/sql-statement';
import type {
    IncludeDiagnosticEvent,
    QueryPlanShape,
} from '../diagnostics/runtime/events';

/**
 * Query-plan shaping and diagnostic emission for one `DbSet`.
 *
 * Both the read path (`DbSetQueryRunner`) and the set-based write path
 * (`DbSet.executeBulk`, `DbSetBulkWriter.upsert`) describe every compile and
 * execute phase the same way, so the shape/emit logic lives here once and is
 * shared by constructor injection rather than duplicated per operation. Kept
 * separate from SQL building because it is pure observability: it never touches
 * the statement, only reports on it.
 */
export class DbSetDiagnostics<TEntity extends object> {
    constructor(
        private readonly context: DbSetContext,
        private readonly entityType: EntityConstructor<TEntity>,
    ) {}

    private get metadata(): EntityMetadata<TEntity> {
        return this.context.modelMetadata.getEntity(this.entityType);
    }

    public queryShape(operation: QueryPlanShape['operation'], model: QueryModel<TEntity>): QueryPlanShape {
        let shape: QueryPlanShape = {
            entityName: this.metadata.entityName,
            operation,
            hasPredicate: Boolean(model.predicate),
            joinCount: model.joins.length,
            joinKinds: model.joins.map(join => join.kind),
            orderingCount: model.orderings.length,
            includeCount: model.includes.length,
            projectionCount: model.projection?.length ?? 0,
            hasOffset: model.offset !== undefined,
            hasLimit: model.limit !== undefined,
            ignoresQueryFilters: Boolean(model.ignoreQueryFilters),
            ignoresTenantScope: Boolean(model.ignoreTenantScope),
        };

        if (model.relationExistence.length > 0) {
            shape = {
                ...shape,
                relationExistenceCount: model.relationExistence.length,
                hasAntiRelationExistence: model.relationExistence.some(expression => expression.operator === 'notExists'),
                hasManyToManyRelationExistence: model.relationExistence.some(expression => expression.relation.kind === 'manyToMany'),
            };
        }
        if (model.trackingBehavior === 'noTracking') {
            shape = {
                ...shape,
                trackingBehavior: 'noTracking',
            };
        }

        const aggregateCount = model.aggregateProjection?.length ?? 0;
        const groupKeyCount = model.groupKeys?.length ?? 0;
        const aggregateOrderingCount = model.aggregateOrderings?.length ?? 0;
        const hasAggregateShape = aggregateCount > 0 || groupKeyCount > 0 || Boolean(model.having) || aggregateOrderingCount > 0;
        return hasAggregateShape
            ? {
                ...shape,
                aggregateCount: aggregateCount > 0 ? aggregateCount : undefined,
                groupKeyCount: groupKeyCount > 0 ? groupKeyCount : undefined,
                hasHaving: model.having ? true : undefined,
                aggregateOrderingCount: aggregateOrderingCount > 0 ? aggregateOrderingCount : undefined,
            }
            : shape;
    }

    public emitQueryPlan(
        phase: 'compile' | 'execute',
        shape: QueryPlanShape,
        durationMs: number,
        statement?: SqlStatement,
        rowCount?: number,
        resultCount?: number,
        error?: unknown,
    ): void {
        for (const handler of this.context.options.diagnostics) {
            handler({
                kind: 'queryPlan',
                provider: this.context.options.provider.provider,
                phase,
                shape,
                sqlText: statement?.text,
                durationMs,
                rowCount,
                resultCount,
                error,
            });
        }
    }

    public emitIncludeDiagnostic(event: Omit<IncludeDiagnosticEvent, 'kind' | 'provider'>): void {
        for (const handler of this.context.options.diagnostics) {
            handler({
                kind: 'include',
                provider: this.context.options.provider.provider,
                ...event,
            });
        }
    }
}
