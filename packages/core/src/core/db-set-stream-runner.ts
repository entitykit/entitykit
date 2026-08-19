import { QueryCompilationError } from '../errors/query-errors';
import { ProviderCapabilityError } from '../errors/runtime-errors';
import { Materializer } from '../materialization/materializer';
import type { EntityMetadata } from '../model/entity-metadata';
import type { QueryModel } from '../query/query-model';
import type { QueryStreamOptions } from '../storage/database-connection';
import type { EntityConstructor } from '../types';
import type { DbSetContext } from './db-set-context';
import type { DbSetDiagnostics } from './db-set-diagnostics';
import { DbSetQueryPipeline } from './db-set-query-pipeline';
import type { DbSetResultMapper } from './db-set-result-mapper';
import { instrumentDbSetStream } from './db-set-stream-pipeline';
import { mapAsyncIterable } from '../storage/map-async-iterable';

/** Compiles, materializes, and instruments lazy `DbSet` row streams. */
export class DbSetStreamRunner<TEntity extends object> {
    private materializerInstance?: Materializer;
    private readonly pipeline: DbSetQueryPipeline<TEntity>;

    constructor(
        private readonly context: DbSetContext,
        private readonly entityType: EntityConstructor<TEntity>,
        private readonly diagnostics: DbSetDiagnostics<TEntity>,
        private readonly resultMapper: DbSetResultMapper<TEntity>,
    ) {
        this.pipeline = new DbSetQueryPipeline(context, entityType, diagnostics);
    }

    private get materializer(): Materializer {
        return this.materializerInstance ??= new Materializer(this.context.valueReader);
    }

    private get metadata(): EntityMetadata<TEntity> {
        return this.context.modelMetadata.getEntity(this.entityType);
    }

    public executeStream(
        model: QueryModel<TEntity>,
        options?: QueryStreamOptions,
    ): AsyncIterable<TEntity> {
        return this.defer(() => {
            this.context.assertCanQuery('stream()');
            const filtered = this.streamModel(model);
            const shape = this.diagnostics.queryShape('stream', filtered);
            const statement = this.pipeline.compile('select', filtered, shape);
            const noTracking = filtered.trackingBehavior === 'noTracking';
            const rows = this.streamRows(statement, options);
            const materializer = this.materializer;
            const metadata = this.metadata;
            const mapped = mapAsyncIterable(
                rows,
                row => noTracking
                    ? materializer.materializeUntracked(metadata, row)
                    : materializer.materialize(
                        metadata,
                        row,
                        this.context.changeTracker,
                    ),
            );
            return instrumentDbSetStream(this.diagnostics, shape, mapped);
        });
    }

    public executeProjectionStream<TProjection extends Record<string, unknown>>(
        model: QueryModel<TEntity>,
        options?: QueryStreamOptions,
    ): AsyncIterable<TProjection> {
        return this.defer(() => {
            this.context.assertCanQuery('stream()');
            const filtered = this.streamModel(model);
            const shape = this.diagnostics.queryShape('stream', filtered);
            const statement = this.pipeline.compile('select', filtered, shape);
            const rows = this.streamRows(statement, options);
            const mapped = mapAsyncIterable(
                rows,
                row => this.resultMapper.materializeProjectionRow(filtered, row) as TProjection,
            );
            return instrumentDbSetStream(this.diagnostics, shape, mapped);
        });
    }

    public executeAggregateStream<TProjection extends Record<string, unknown>>(
        model: QueryModel<TEntity>,
        options?: QueryStreamOptions,
    ): AsyncIterable<TProjection> {
        return this.defer(() => {
            this.context.assertCanQuery('stream()');
            const filtered = this.streamModel(model);
            const shape = this.diagnostics.queryShape('stream', filtered);
            const statement = this.pipeline.compile('aggregate', filtered, shape);
            const rows = this.streamRows(statement, options);
            const mapped = mapAsyncIterable(
                rows,
                row => this.resultMapper.materializeAggregateRow(filtered, row) as TProjection,
            );
            return instrumentDbSetStream(this.diagnostics, shape, mapped);
        });
    }

    private defer<TResult>(
        createRows: () => AsyncIterable<TResult>,
    ): AsyncIterable<TResult> {
        return {
            async *[Symbol.asyncIterator]() {
                yield* createRows();
            },
        };
    }

    private streamModel(model: QueryModel<TEntity>): QueryModel<TEntity> {
        const filtered = this.context.applyQueryFilters(this.metadata, model);
        if (filtered.includes.length > 0) {
            throw new QueryCompilationError(
                'stream() does not support include(). Stream the root query without includes or use toArray() to load the complete graph.',
            );
        }
        return filtered;
    }

    private streamRows(
        statement: { readonly text: string; readonly values: readonly unknown[] },
        options?: QueryStreamOptions,
    ): AsyncIterable<Record<string, unknown>> {
        if (!this.context.database.stream) {
            throw new ProviderCapabilityError(
                'streaming queries',
                this.context.options.provider.provider,
            );
        }
        return this.context.database.stream(statement, options);
    }
}
