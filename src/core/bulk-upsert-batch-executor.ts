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
import type { CapturedBulkUpsertRow } from './bulk-upsert-row';
import type { BulkUpsertGeneratedValues } from './bulk-upsert-generated-values';

interface BulkUpsertBatchExecution<TEntity extends object> {
    readonly context: DbSetContext;
    readonly metadata: EntityMetadata<TEntity>;
    readonly diagnostics: DbSetDiagnostics<TEntity>;
    readonly sql: ModificationSqlBuilder;
    readonly rows: ReadonlyArray<CapturedBulkUpsertRow<TEntity>>;
    readonly options: UpsertSqlOptions<TEntity> & DatabaseOperationOptions;
    readonly tenantMatchProperty?: EntityPropertyKey<TEntity>;
    readonly batchSize: number;
    readonly generatedValues: BulkUpsertGeneratedValues<TEntity>;
}

export async function executeBulkUpsertBatches<TEntity extends object>(
    execution: BulkUpsertBatchExecution<TEntity>,
): Promise<number> {
    const run = async (): Promise<number> => {
        let affected = 0;
        for (
            let start = 0;
            start < execution.rows.length;
            start += execution.batchSize
        ) {
            const batch = execution.rows.slice(
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
    batch: ReadonlyArray<CapturedBulkUpsertRow<TEntity>>,
): Promise<void> {
    const shape = execution.diagnostics.queryShape(
        'upsert',
        createQueryModel(execution.metadata.ctor),
    );
    const compileElapsed = startElapsedTimer();
    let statement: SqlStatement;
    try {
        statement = execution.sql.buildUpsertValuesBatch(
            execution.metadata,
            batch.map(row => row.values),
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
        execution.generatedValues.hydrate(batch[0], result);
    } catch (error) {
        execution.diagnostics.emitQueryPlan(
            'execute', shape, executeElapsed(),
            undefined, undefined, undefined, error,
        );
        throw mapDatabaseProviderError(error);
    }
}
