import type { EntityMetadata } from '../model/entity-metadata';
import { SelectSqlBuilder } from '../sql/select-sql-builder';
import type { SqlStatement } from '../sql/sql-statement';
import { cloneQueryModel, type QueryModel } from './query-model';
import type { QueryExecutor } from './queryable-helpers';
import { createQueryPlan, type QueryPlan } from './query-plan';
import { terminalQueryLimit } from './terminal-query-limit';
import { formatDebugSql, type DebugSqlOptions } from '../sql/debug-sql';
import type { DatabaseOperationOptions, QueryStreamOptions } from '../storage/database-connection';
import { ProviderCapabilityError } from '../errors/runtime-errors';
import { firstResultOrNull, requireQueryResult, singleResultOrNull } from './query-cardinality';
/** Terminal execution shared by entity and joined aggregate projections. */
export abstract class AggregateQueryTerminals<
    TEntity extends object,
    TProjection extends Record<string, unknown>,
> {
    constructor(
        protected readonly metadata: EntityMetadata<TEntity>,
        protected readonly executor: QueryExecutor<TEntity>,
        protected readonly model: QueryModel<TEntity>,
    ) {}

    public async toArray(options?: DatabaseOperationOptions): Promise<TProjection[]> {
        return this.executor.executeAggregateToArray<TProjection>(
            this.toQueryModel(),
            options,
        );
    }

    public stream(options?: QueryStreamOptions): AsyncIterable<TProjection> {
        if (!this.executor.executeAggregateStream) {
            throw new ProviderCapabilityError('streaming aggregate queries');
        }
        return this.executor.executeAggregateStream<TProjection>(
            this.toQueryModel(),
            options,
        );
    }

    public toPlan(): QueryPlan {
        return createQueryPlan(this.model);
    }
    public async firstOrNull(options?: DatabaseOperationOptions): Promise<TProjection | null> {
        const rows = await this.executeWithLimit(1, options);
        return firstResultOrNull(rows);
    }

    public async first(options?: DatabaseOperationOptions): Promise<TProjection> {
        return requireQueryResult(
            await this.firstOrNull(options),
            this.metadata.entityName,
            'projection',
        );
    }

    public async singleOrNull(options?: DatabaseOperationOptions): Promise<TProjection | null> {
        const rows = await this.executeWithLimit(2, options);
        return singleResultOrNull(
            rows,
            this.metadata.entityName,
            'projection',
        );
    }

    public async single(options?: DatabaseOperationOptions): Promise<TProjection> {
        return requireQueryResult(
            await this.singleOrNull(options),
            this.metadata.entityName,
            'projection',
        );
    }

    public toSql(): SqlStatement {
        const model = this.toQueryModel();
        return (
            this.executor.buildAggregateSql?.(model) ??
      new SelectSqlBuilder().buildAggregate(this.metadata, model)
        );
    }
    public toDebugSql(options: DebugSqlOptions = {}): string {
        return formatDebugSql(this.toSql(), options);
    }

    public abstract toQueryModel(): QueryModel<TEntity>;
    private async executeWithLimit(requested: number, options?: DatabaseOperationOptions): Promise<TProjection[]> {
        const model = this.toQueryModel();
        if (!model.groupKeys || model.groupKeys.length === 0) {
            return this.executor.executeAggregateToArray<TProjection>(model, options);
        }
        return this.executor.executeAggregateToArray<TProjection>(
            cloneQueryModel(model, {
                limit: terminalQueryLimit(model.limit, requested),
            }),
            options,
        );
    }
}
