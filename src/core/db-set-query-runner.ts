import type { EntityConstructor } from '../types';
import type { DbSetContext } from './db-set-context';
import type { EntityMetadata } from '../model/entity-metadata';
import type { QueryModel } from '../query/query-model';
import { Materializer } from '../materialization/materializer';
import { IncludeLoader } from '../query/include-loader';
import type { DbSetDiagnostics } from './db-set-diagnostics';
import type { DbSetResultMapper } from './db-set-result-mapper';
import { DbSetQueryPipeline } from './db-set-query-pipeline';
import { ChangeTracker } from '../tracking/change-tracker';
import type { DatabaseOperationOptions } from '../storage/database-connection';
import { DbSetCountRunner } from './db-set-count-runner';
/** Runs full-entity, scalar, projection, and aggregate reads for a `DbSet`. */
export class DbSetQueryRunner<TEntity extends object> {
    private materializerInstance?: Materializer;
    private readonly pipeline: DbSetQueryPipeline<TEntity>;
    private readonly counts: DbSetCountRunner<TEntity>;

    constructor(
        private readonly context: DbSetContext,
        private readonly entityType: EntityConstructor<TEntity>,
        private readonly diagnostics: DbSetDiagnostics<TEntity>,
        private readonly resultMapper: DbSetResultMapper<TEntity>,
    ) {
        this.pipeline = new DbSetQueryPipeline(context, entityType, diagnostics);
        this.counts = new DbSetCountRunner(context, entityType, diagnostics, this.pipeline);
    }

    private get metadata(): EntityMetadata<TEntity> {
        return this.context.modelMetadata.getEntity(this.entityType);
    }

    private get materializer(): Materializer {
        return this.materializerInstance ??= new Materializer(this.context.valueReader);
    }

    public async executeToArray(model: QueryModel<TEntity>, options?: DatabaseOperationOptions): Promise<TEntity[]> {
        const filteredModel = this.context.applyQueryFilters(this.metadata, model);
        const shape = this.diagnostics.queryShape('toArray', filteredModel);
        const statement = this.pipeline.compile('select', filteredModel, shape);
        const tracker = filteredModel.trackingBehavior === 'noTracking'
            ? new ChangeTracker()
            : this.context.changeTracker;
        try {
            return await this.pipeline.execute(
                shape,
                async () => {
                    const result = await this.context.database.query(statement, options);
                    const entities = this.materializer.materializeMany(
                        this.metadata, result.rows, tracker,
                    );
                    return {
                        value: entities,
                        rowCount: result.rowCount,
                        resultCount: entities.length,
                    };
                },
                async entities =>
                    this.loadIncludes(entities, filteredModel, tracker, options),
            );
        } finally {
            if (tracker !== this.context.changeTracker) {
                tracker.clear();
            }
        }
    }

    public async executeCount(model: QueryModel<TEntity>, options?: DatabaseOperationOptions): Promise<number> {
        return this.counts.executeNumber(model, options);
    }

    public async executeCountBigInt(
        model: QueryModel<TEntity>,
        options?: DatabaseOperationOptions,
    ): Promise<bigint> {
        return this.counts.executeBigInt(model, options);
    }

    public async executeExists(model: QueryModel<TEntity>, options?: DatabaseOperationOptions): Promise<boolean> {
        const filteredModel = this.context.applyQueryFilters(this.metadata, model);
        const shape = this.diagnostics.queryShape('exists', filteredModel);
        const statement = this.pipeline.compile('exists', filteredModel, shape);
        return this.pipeline.execute(shape, async () => {
            const result = await this.context.database.query<{ exists: boolean | number }>(statement, options);
            const exists = result.rows[0]?.exists;
            return {
                value: exists === true || exists === 1,
                rowCount: result.rowCount,
                resultCount: result.rows.length,
            };
        });
    }

    public async executeProjectionToArray<TProjection extends Record<string, unknown>>(model: QueryModel<TEntity>, options?: DatabaseOperationOptions): Promise<TProjection[]> {
        const filteredModel = this.context.applyQueryFilters(this.metadata, model);
        const shape = this.diagnostics.queryShape('projection', filteredModel);
        const statement = this.pipeline.compile('select', filteredModel, shape);
        return this.pipeline.execute(shape, async () => {
            const result = await this.context.database.query(statement, options);
            const rows = this.resultMapper.materializeProjectionRows<TProjection>(
                filteredModel,
                result.rows,
            );
            return {
                value: rows,
                rowCount: result.rowCount,
                resultCount: rows.length,
            };
        });
    }

    public async executeAggregateToArray<TProjection extends Record<string, unknown>>(model: QueryModel<TEntity>, options?: DatabaseOperationOptions): Promise<TProjection[]> {
        const filteredModel = this.context.applyQueryFilters(this.metadata, model);
        const shape = this.diagnostics.queryShape('aggregate', filteredModel);
        const statement = this.pipeline.compile('aggregate', filteredModel, shape);
        return this.pipeline.execute(shape, async () => {
            const result = await this.context.database.query(statement, options);
            const rows = result.rows.map(row =>
                this.resultMapper.materializeAggregateRow(filteredModel, row) as TProjection,
            );
            return {
                value: rows,
                rowCount: result.rowCount,
                resultCount: rows.length,
            };
        });
    }

    private async loadIncludes(
        entities: readonly TEntity[],
        model: QueryModel<TEntity>,
        changeTracker: ChangeTracker,
        options?: DatabaseOperationOptions,
    ): Promise<void> {
        return new IncludeLoader(
            this.context.modelMetadata,
            this.context.database,
            changeTracker,
            (metadata, query) => this.context.applyQueryFilters(metadata, query),
            this.context.dialect,
            event => {
                this.diagnostics.emitIncludeDiagnostic(event);
            },
            this.context.valueReader,
            options,
        ).load(this.metadata, entities, model.includes);
    }
}
