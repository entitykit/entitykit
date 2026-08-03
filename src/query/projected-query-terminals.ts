import type { EntityMetadata } from '../model/entity-metadata';
import { SelectSqlBuilder } from '../sql/select-sql-builder';
import type { SqlStatement } from '../sql/sql-statement';
import type { QueryModel } from './query-model';
import type { QueryExecutor } from './queryable-helpers';
import { createQueryPlan, type QueryPlan } from './query-plan';
import { terminalQueryLimit } from './terminal-query-limit';
import {
    formatDebugSql,
    type DebugSqlOptions,
} from '../sql/debug-sql';
import type { DatabaseOperationOptions, QueryStreamOptions } from '../storage/database-connection';
import { ProviderCapabilityError } from '../errors/runtime-errors';
import {
    firstResultOrNull,
    requireQueryResult,
    singleResultOrNull,
} from './query-cardinality';

/** Terminal execution shared by entity and joined projected query builders. */
export abstract class ProjectedQueryTerminals<
    TEntity extends object,
    TProjection extends Record<string, unknown>,
> {
    constructor(
        protected readonly metadata: EntityMetadata<TEntity>,
        protected readonly executor: QueryExecutor<TEntity>,
        protected readonly model: QueryModel<TEntity>,
    ) {}

    public async toArray(options?: DatabaseOperationOptions): Promise<TProjection[]> {
        return this.executor.executeProjectionToArray<TProjection>(
            this.toQueryModel(),
            options,
        );
    }

    public stream(options?: QueryStreamOptions): AsyncIterable<TProjection> {
        if (!this.executor.executeProjectionStream) {
            throw new ProviderCapabilityError('streaming projection queries');
        }
        return this.executor.executeProjectionStream<TProjection>(
            this.toQueryModel(),
            options,
        );
    }

    public toPlan(): QueryPlan {
        return createQueryPlan(this.model);
    }

    public async firstOrNull(options?: DatabaseOperationOptions): Promise<TProjection | null> {
        const rows = await this.with({
            limit: terminalQueryLimit(this.model.limit, 1),
        }).toArray(options);
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
        const rows = await this.with({
            limit: terminalQueryLimit(this.model.limit, 2),
        }).toArray(options);
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

    public async count(options?: DatabaseOperationOptions): Promise<number> {
        return this.executor.executeCount(this.toQueryModel(), options);
    }

    public async countBigInt(
        options?: DatabaseOperationOptions,
    ): Promise<bigint> {
        if (!this.executor.executeCountBigInt) {
            throw new ProviderCapabilityError('countBigInt()');
        }
        return this.executor.executeCountBigInt(this.toQueryModel(), options);
    }

    public async exists(options?: DatabaseOperationOptions): Promise<boolean> {
        return this.executor.executeExists(this.toQueryModel(), options);
    }

    public toSql(): SqlStatement {
        const model = this.toQueryModel();
        return (
            this.executor.buildSelectSql?.(model) ??
      new SelectSqlBuilder().build(this.metadata, model)
        );
    }

    public toDebugSql(options: DebugSqlOptions = {}): string {
        return formatDebugSql(this.toSql(), options);
    }

    public abstract toQueryModel(): QueryModel<TEntity>;

    protected abstract with(
        changes: Partial<Omit<QueryModel<TEntity>, 'entityType'>>
    ): ProjectedQueryTerminals<TEntity, TProjection>;
}
