import type { EntityMetadata } from '../model/entity-metadata';
import type { QueryModel } from '../query/query-model';
import type { DatabaseOperationOptions } from '../storage/database-connection';
import type { EntityConstructor } from '../types';
import type { DbSetContext } from './db-set-context';
import type { DbSetDiagnostics } from './db-set-diagnostics';
import type { DbSetQueryPipeline } from './db-set-query-pipeline';
import {
    queryCountBigInt,
    queryCountNumber,
    type QueryCountValue,
} from './query-count-result';

/** Executes exact and number-narrowed count terminals for a DbSet. */
export class DbSetCountRunner<TEntity extends object> {
    constructor(
        private readonly context: DbSetContext,
        private readonly entityType: EntityConstructor<TEntity>,
        private readonly diagnostics: DbSetDiagnostics<TEntity>,
        private readonly pipeline: DbSetQueryPipeline<TEntity>,
    ) {}

    private get metadata(): EntityMetadata<TEntity> {
        return this.context.modelMetadata.getEntity(this.entityType);
    }

    public async executeNumber(
        model: QueryModel<TEntity>,
        options?: DatabaseOperationOptions,
    ): Promise<number> {
        return this.execute(model, 'count', queryCountNumber, options);
    }

    public async executeBigInt(
        model: QueryModel<TEntity>,
        options?: DatabaseOperationOptions,
    ): Promise<bigint> {
        return this.execute(model, 'countBigInt', queryCountBigInt, options);
    }

    private async execute<TResult>(
        model: QueryModel<TEntity>,
        operation: 'count' | 'countBigInt',
        convert: (value: QueryCountValue) => TResult,
        options?: DatabaseOperationOptions,
    ): Promise<TResult> {
        const filteredModel = this.context.applyQueryFilters(this.metadata, model);
        const shape = this.diagnostics.queryShape(operation, filteredModel);
        const statement = this.pipeline.compile('count', filteredModel, shape);
        return this.pipeline.execute(shape, async () => {
            const result = await this.context.database.query<{
                count: QueryCountValue;
            }>(statement, options);
            return {
                value: convert(result.rows[0]?.count ?? 0),
                rowCount: result.rowCount,
                resultCount: result.rows.length,
            };
        });
    }
}
