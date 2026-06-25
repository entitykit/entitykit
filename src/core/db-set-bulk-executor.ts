import type { EntityConstructor, EntityUpdateValues } from '../types';
import type { EntityMetadata } from '../model/entity-metadata';
import type { QueryModel } from '../query/query-model';
import type { QueryPlanShape } from '../diagnostics/runtime/events';
import { ModificationSqlBuilder } from '../sql/modification-sql-builder';
import type { SqlStatement } from '../sql/sql-statement';
import type { DbSetContext } from './db-set-context';
import type { DbSetDiagnostics } from './db-set-diagnostics';
import { assertBulkMutationSupported } from './db-set-bulk-validation';
import type { DatabaseOperationOptions } from '../storage/database-connection';
import { startElapsedTimer } from '../diagnostics/runtime/elapsed-time';

export class DbSetBulkExecutor<TEntity extends object> {
    private modificationSqlBuilder?: ModificationSqlBuilder;
    constructor(
        private readonly context: DbSetContext,
        private readonly entityType: EntityConstructor<TEntity>,
        private readonly diagnostics: DbSetDiagnostics<TEntity>,
    ) {}

    public async executeUpdate(model: QueryModel<TEntity>, values: EntityUpdateValues<TEntity>, options?: DatabaseOperationOptions): Promise<number> {
        return this.executeBulk(
            'executeUpdate',
            model,
            (metadata, filteredModel) => {
                const predicate = filteredModel.predicate;
                if (!predicate) {
                    throw new Error(
                        'executeUpdate() lost its required predicate while applying query filters.',
                    );
                }
                return this.modificationSql().buildBulkUpdate(
                    metadata,
                    { values, predicate: predicate.node },
                );
            },
            options,
        );
    }

    public async executeDelete(model: QueryModel<TEntity>, options?: DatabaseOperationOptions): Promise<number> {
        return this.executeBulk(
            'executeDelete',
            model,
            (metadata, filteredModel) => {
                const predicate = filteredModel.predicate;
                if (!predicate) {
                    throw new Error(
                        'executeDelete() lost its required predicate while applying query filters.',
                    );
                }
                return this.modificationSql().buildBulkDelete(
                    metadata,
                    { predicate: predicate.node },
                );
            },
            options,
        );
    }

    private get metadata(): EntityMetadata<TEntity> {
        return this.context.modelMetadata.getEntity(this.entityType);
    }

    private async executeBulk(
        operation: 'executeUpdate' | 'executeDelete',
        model: QueryModel<TEntity>,
        build: (metadata: EntityMetadata<TEntity>, filteredModel: QueryModel<TEntity>) => SqlStatement,
        options?: DatabaseOperationOptions,
    ): Promise<number> {
        const label = `${operation}()`;
        this.metadata.assertWritable(label);
        assertBulkMutationSupported(model, label);

        const filteredModel = this.context.applyQueryFilters(this.metadata, model);
        const shape = this.diagnostics.queryShape(operation, filteredModel);
        const compileElapsed = startElapsedTimer();
        let statement: SqlStatement;
        try {
            statement = build(this.metadata, filteredModel);
            this.emit('compile', shape, compileElapsed(), statement);
        } catch (error) {
            this.emit(
                'compile',
                shape,
                compileElapsed(),
                undefined,
                undefined,
                undefined,
                error,
            );
            throw error;
        }

        const executeElapsed = startElapsedTimer();
        try {
            const result = await this.context.database.query(statement, options);
            this.emit(
                'execute',
                shape,
                executeElapsed(),
                undefined,
                result.rowCount,
                result.rowCount,
            );
            return result.rowCount;
        } catch (error) {
            this.emit(
                'execute',
                shape,
                executeElapsed(),
                undefined,
                undefined,
                undefined,
                error,
            );
            throw error;
        }
    }

    private modificationSql(): ModificationSqlBuilder {
        this.modificationSqlBuilder ??= new ModificationSqlBuilder(
            this.context.dialect,
        );
        return this.modificationSqlBuilder;
    }

    private emit(
        phase: 'compile' | 'execute',
        shape: QueryPlanShape,
        durationMs: number,
        statement?: SqlStatement,
        rowCount?: number,
        resultCount?: number,
        error?: unknown,
    ): void {
        this.diagnostics.emitQueryPlan(
            phase,
            shape,
            durationMs,
            statement,
            rowCount,
            resultCount,
            error,
        );
    }
}
