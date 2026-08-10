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
    const batches = prepareBatches(execution);
    const run = async (): Promise<number> => {
        let affected = 0;
        for (const batch of batches) {
            await executeBatch(execution, batch);
            affected += batch.rows.length;
        }
        return affected;
    };

    return execution.context.database.transaction(run, {
        signal: execution.options.signal,
    });
}

interface PreparedBulkUpsertBatch<TEntity extends object> {
    readonly rows: ReadonlyArray<CapturedBulkUpsertRow<TEntity>>;
    readonly statement: SqlStatement;
    readonly shape: ReturnType<DbSetDiagnostics<TEntity>['queryShape']>;
}

function prepareBatches<TEntity extends object>(
    execution: BulkUpsertBatchExecution<TEntity>,
): Array<PreparedBulkUpsertBatch<TEntity>> {
    const batches: Array<PreparedBulkUpsertBatch<TEntity>> = [];
    for (let start = 0; start < execution.rows.length; start += execution.batchSize) {
        const rows = execution.rows.slice(start, start + execution.batchSize);
        const shape = execution.diagnostics.queryShape(
            'upsert', createQueryModel(execution.metadata.ctor),
        );
        const compileElapsed = startElapsedTimer();
        try {
            const statement = execution.sql.buildUpsertProviderValuesBatch(
                execution.metadata,
                rows.map(row => row.providerValues),
                execution.options,
                execution.tenantMatchProperty,
            );
            execution.diagnostics.emitQueryPlan(
                'compile', shape, compileElapsed(), statement,
            );
            batches.push({ rows, statement, shape });
        } catch (error) {
            execution.diagnostics.emitQueryPlan(
                'compile', shape, compileElapsed(),
                undefined, undefined, undefined, error,
            );
            throw error;
        }
    }
    return batches;
}

async function executeBatch<TEntity extends object>(
    execution: BulkUpsertBatchExecution<TEntity>,
    batch: PreparedBulkUpsertBatch<TEntity>,
): Promise<void> {
    const executeElapsed = startElapsedTimer();
    try {
        const result = await execution.context.database.query(
            batch.statement,
            execution.options,
        );
        execution.diagnostics.emitQueryPlan(
            'execute', batch.shape, executeElapsed(), undefined, result.rowCount,
        );
        if (
            execution.tenantMatchProperty &&
            execution.context.dialect.upsertConflictTarget !== 'anyUnique' &&
            result.rowCount !== batch.rows.length
        ) {
            throw new TenantOwnershipError(
                execution.metadata.entityName,
                execution.tenantMatchProperty,
                'upsert-conflict',
            );
        }
        execution.generatedValues.hydrate(batch.rows[0], result);
    } catch (error) {
        execution.diagnostics.emitQueryPlan(
            'execute', batch.shape, executeElapsed(),
            undefined, undefined, undefined, error,
        );
        throw mapDatabaseProviderError(error);
    }
}
