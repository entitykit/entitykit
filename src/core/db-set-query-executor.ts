import type { EntityMetadata } from '../model/entity-metadata';
import type { QueryExecutor } from '../query/queryable-helpers';
import type { QueryModel } from '../query/query-model';
import type { RelationExistenceMetadata } from '../query/relation-expression';
import { SelectSqlBuilder } from '../sql/select-sql-builder';
import type { SqlStatement } from '../sql/sql-statement';
import type { EntityConstructor, EntityUpdateValues } from '../types';
import { DbSetBulkExecutor } from './db-set-bulk-executor';
import type { DbSetContext } from './db-set-context';
import type { DbSetDiagnostics } from './db-set-diagnostics';
import { DbSetQueryRunner } from './db-set-query-runner';
import { DbSetRelationResolver } from './db-set-relation-resolver';
import { DbSetResultMapper } from './db-set-result-mapper';
import type { DatabaseOperationOptions, QueryStreamOptions } from '../storage/database-connection';
import { DbSetStreamRunner } from './db-set-stream-runner';

/** Internal adapter between public query builders and DbSet execution services. */
export class DbSetQueryExecutor<TEntity extends object>
implements QueryExecutor<TEntity> {
    private selectSql?: SelectSqlBuilder;
    private readonly bulk: DbSetBulkExecutor<TEntity>;
    private readonly runner: DbSetQueryRunner<TEntity>;
    private readonly streaming: DbSetStreamRunner<TEntity>;
    private readonly relations: DbSetRelationResolver<TEntity>;

    constructor(
        private readonly context: DbSetContext,
        private readonly entityType: EntityConstructor<TEntity>,
        diagnostics: DbSetDiagnostics<TEntity>,
    ) {
        this.bulk = new DbSetBulkExecutor(context, entityType, diagnostics);
        const resultMapper = new DbSetResultMapper(context, entityType);
        this.runner = new DbSetQueryRunner(
            context,
            entityType,
            diagnostics,
            resultMapper,
        );
        this.streaming = new DbSetStreamRunner(
            context,
            entityType,
            diagnostics,
            resultMapper,
        );
        this.relations = new DbSetRelationResolver(context, entityType);
    }

    private get metadata(): EntityMetadata<TEntity> {
        return this.context.modelMetadata.getEntity(this.entityType);
    }

    public async executeToArray(model: QueryModel<TEntity>, options?: DatabaseOperationOptions): Promise<TEntity[]> {
        return this.runner.executeToArray(model, options);
    }

    public executeStream(
        model: QueryModel<TEntity>,
        options?: QueryStreamOptions,
    ): AsyncIterable<TEntity> {
        return this.streaming.executeStream(model, options);
    }

    public async executeCount(model: QueryModel<TEntity>, options?: DatabaseOperationOptions): Promise<number> {
        return this.runner.executeCount(model, options);
    }

    public async executeExists(model: QueryModel<TEntity>, options?: DatabaseOperationOptions): Promise<boolean> {
        return this.runner.executeExists(model, options);
    }

    public async executeProjectionToArray<TProjection extends Record<string, unknown>>(
        model: QueryModel<TEntity>,
        options?: DatabaseOperationOptions,
    ): Promise<TProjection[]> {
        return this.runner.executeProjectionToArray<TProjection>(model, options);
    }

    public executeProjectionStream<TProjection extends Record<string, unknown>>(
        model: QueryModel<TEntity>,
        options?: QueryStreamOptions,
    ): AsyncIterable<TProjection> {
        return this.streaming.executeProjectionStream<TProjection>(model, options);
    }

    public async executeAggregateToArray<TProjection extends Record<string, unknown>>(
        model: QueryModel<TEntity>,
        options?: DatabaseOperationOptions,
    ): Promise<TProjection[]> {
        return this.runner.executeAggregateToArray<TProjection>(model, options);
    }

    public executeAggregateStream<TProjection extends Record<string, unknown>>(
        model: QueryModel<TEntity>,
        options?: QueryStreamOptions,
    ): AsyncIterable<TProjection> {
        return this.streaming.executeAggregateStream<TProjection>(model, options);
    }

    public async executeUpdate(
        model: QueryModel<TEntity>,
        values: EntityUpdateValues<TEntity>,
        options?: DatabaseOperationOptions,
    ): Promise<number> {
        return this.bulk.executeUpdate(model, values, options);
    }

    public async executeDelete(model: QueryModel<TEntity>, options?: DatabaseOperationOptions): Promise<number> {
        return this.bulk.executeDelete(model, options);
    }

    public buildSelectSql(model: QueryModel<TEntity>): SqlStatement {
        return this.sql().build(
            this.metadata,
            this.context.applyQueryFilters(this.metadata, model),
        );
    }

    public buildAggregateSql(model: QueryModel<TEntity>): SqlStatement {
        return this.sql().buildAggregate(
            this.metadata,
            this.context.applyQueryFilters(this.metadata, model),
        );
    }

    public resolveRelationExistence(navigationProperty: string): RelationExistenceMetadata {
        return this.relations.resolve(navigationProperty);
    }

    private sql(): SelectSqlBuilder {
        return this.selectSql ??= new SelectSqlBuilder(this.context.dialect);
    }
}
