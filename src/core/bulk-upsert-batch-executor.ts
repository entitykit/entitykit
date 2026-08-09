import { mapDatabaseProviderError } from '../errors/db-update-error';
import { TenantOwnershipError } from '../errors/tenant-ownership-error';
import type { EntityMetadata } from '../model/entity-metadata';
import { createQueryModel } from '../query/query-model';
import type {
    ModificationSqlBuilder,
    UpsertSqlOptions,
} from '../sql/modification-sql-builder';
import type { SqlStatement } from '../sql/sql-statement';
import type { DatabaseOperationOptions } from '../storage/database-connection';
import type { EntityPropertyKey } from '../types';
import { startElapsedTimer } from '../diagnostics/runtime/elapsed-time';
import type { DbSetContext } from './db-set-context';
import type { DbSetDiagnostics } from './db-set-diagnostics';

interface BulkUpsertBatchExecution<TEntity extends object> {
    readonly context: DbSetContext;
    readonly metadata: EntityMetadata<TEntity>;
    readonly diagnostics: DbSetDiagnostics<TEntity>;
    readonly sql: ModificationSqlBuilder;
    readonly entities: readonly TEntity[];
    readonly options: UpsertSqlOptions<TEntity> & DatabaseOperationOptions;
    readonly tenantMatchProperty?: EntityPropertyKey<TEntity>;
    readonly batchSize: number;
}

export async function executeBulkUpsertBatches<TEntity extends object>(
    execution: BulkUpsertBatchExecution<TEntity>,
): Promise<number> {
    const run = async (): Promise<number> => {
        let affected = 0;
        for (
            let start = 0;
            start < execution.entities.length;
            start += execution.batchSize
        ) {
            const batch = execution.entities.slice(
                start,
                start + execution.batchSize,
            );
            await executeBatch(execution, batch);
            affected += batch.length;
        }
        return affected;
    };

    return execution.context.database.transaction(run, {
        signal: execution.options.signal,
    });
}

async function executeBatch<TEntity extends object>(
    execution: BulkUpsertBatchExecution<TEntity>,
    batch: readonly TEntity[],
): Promise<void> {
    const shape = execution.diagnostics.queryShape(
        'upsert',
        createQueryModel(execution.metadata.ctor),
    );
    const compileElapsed = startElapsedTimer();
    let statement: SqlStatement;
    try {
        statement = execution.sql.buildUpsertBatch(
            execution.metadata,
            batch,
            execution.options,
            execution.tenantMatchProperty,
        );
        execution.diagnostics.emitQueryPlan(
            'compile', shape, compileElapsed(), statement,
        );
    } catch (error) {
        execution.diagnostics.emitQueryPlan(
            'compile', shape, compileElapsed(),
            undefined, undefined, undefined, error,
        );
        throw error;
    }

    const executeElapsed = startElapsedTimer();
    try {
        const result = await execution.context.database.query(
            statement,
            execution.options,
        );
        execution.diagnostics.emitQueryPlan(
            'execute', shape, executeElapsed(), undefined, result.rowCount,
        );
        if (
            execution.tenantMatchProperty &&
            execution.context.dialect.upsertConflictTarget !== 'anyUnique' &&
            result.rowCount !== batch.length
        ) {
            throw new TenantOwnershipError(
                execution.metadata.entityName,
                execution.tenantMatchProperty,
                'upsert-conflict',
            );
        }
    } catch (error) {
        execution.diagnostics.emitQueryPlan(
            'execute', shape, executeElapsed(),
            undefined, undefined, undefined, error,
        );
        throw mapDatabaseProviderError(error);
    }
}
