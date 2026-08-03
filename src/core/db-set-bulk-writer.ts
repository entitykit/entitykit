import type { EntityConstructor } from '../types';
import type { DbSetContext } from './db-set-context';
import type { EntityMetadata } from '../model/entity-metadata';
import type { SqlStatement } from '../sql/sql-statement';
import { DbValidationError } from '../errors/entity-kit-error';
import { mapDatabaseProviderError } from '../errors/db-update-error';
import { ModificationSqlBuilder, type UpsertSqlOptions } from '../sql/modification-sql-builder';
import { createQueryModel } from '../query/query-model';
import type { DbSetDiagnostics } from './db-set-diagnostics';
import type { DatabaseOperationOptions } from '../storage/database-connection';
import { startElapsedTimer } from '../diagnostics/runtime/elapsed-time';
import { TenantScopeUnavailableError } from '../errors/tenant-scope-unavailable-error';

/**
 * The batched `upsert` write for a `DbSet`.
 *
 * Unlike `executeUpdate`/`executeDelete`, which start from a caller's query
 * model, upsert starts from a list of entities: it enforces tenant scope per
 * entity, sizes batches to the provider's bound-parameter limit, and runs them
 * in a single transaction. That is a self-contained concern with its own
 * invariants, so it lives here rather than inflating `DbSet`. Diagnostics are
 * delegated to the shared `DbSetDiagnostics` so its plan events match every
 * other operation.
 */
export class DbSetBulkWriter<TEntity extends object> {
    private modificationSqlBuilder?: ModificationSqlBuilder;

    constructor(
        private readonly context: DbSetContext,
        private readonly entityType: EntityConstructor<TEntity>,
        private readonly diagnostics: DbSetDiagnostics<TEntity>,
    ) {}

    private get metadata(): EntityMetadata<TEntity> {
        return this.context.modelMetadata.getEntity(this.entityType);
    }

    /**
   * Insert entities, overwriting rows that already exist.
   *
   * Set-based like `executeUpdate` and `executeDelete`: one statement per
   * batch rather than a pass through the change tracker, so save interceptors,
   * audit fields, concurrency tokens, and outbox events do not apply. Tenant
   * scope does, because that is an isolation boundary rather than a
   * convenience — every entity must belong to the current tenant.
   *
   * Batches are sized to the provider's bound-parameter limit and run in one
   * transaction, so a failure in a later batch leaves nothing from the earlier
   * ones.
   */
    public async upsert(
        entities: readonly TEntity[],
        options: UpsertSqlOptions<TEntity> & DatabaseOperationOptions = {},
    ): Promise<number> {
        if (entities.length === 0) {
            return 0;
        }

        const tenantId = this.metadata.tenantKeyProperty
            ? this.context.currentTenantIdForWrites()
            : undefined;
        for (const entity of entities) {
            this.assertEntityInTenantScope(
                entity,
                tenantId,
                this.context.allowsCrossTenantAccess(),
            );
        }

        const sql = this.modificationSql();
        const parametersPerRow = Math.max(this.metadata.properties.length, 1);
        const limit = this.context.options.dialect.maxStatementParameters?.();
        const batchSize = limit === undefined
            ? entities.length
            : Math.max(Math.floor(limit / parametersPerRow), 1);

        const run = async (): Promise<number> => {
            let affected = 0;
            for (let start = 0; start < entities.length; start += batchSize) {
                const batch = entities.slice(start, start + batchSize);
                const shape = this.diagnostics.queryShape('upsert', createQueryModel(this.metadata.ctor));
                const compileElapsed = startElapsedTimer();
                let statement: SqlStatement;
                try {
                    statement = sql.buildUpsertBatch(this.metadata, batch, options);
                    this.diagnostics.emitQueryPlan('compile', shape, compileElapsed(), statement);
                } catch (error) {
                    this.diagnostics.emitQueryPlan('compile', shape, compileElapsed(), undefined, undefined, undefined, error);
                    throw error;
                }

                const executeElapsed = startElapsedTimer();
                try {
                    const result = await this.context.database.query(statement, options);
                    this.diagnostics.emitQueryPlan('execute', shape, executeElapsed(), undefined, result.rowCount);
                    // Public upsert accounting is provider-neutral: one successfully
                    // processed input entity counts once. MySQL reports an updated row
                    // as two affected rows, unlike Postgres and SQLite.
                    affected += batch.length;
                } catch (error) {
                    this.diagnostics.emitQueryPlan('execute', shape, executeElapsed(), undefined, undefined, undefined, error);
                    throw mapDatabaseProviderError(error);
                }
            }
            return affected;
        };

        // Always enter the connection transaction API. Inside an explicit context
        // transaction this becomes a savepoint, so a caught later-batch failure
        // cannot leave earlier batches committed.
        return this.context.database.transaction(run, {
            signal: options.signal,
        });
    }

    /**
   * Refuse an entity belonging to another tenant.
   *
   * The same rule `saveChanges()` applies. A set-based write must not be the
   * way around an isolation boundary the tracked path enforces.
   */
    private assertEntityInTenantScope(
        entity: TEntity,
        tenantId: unknown,
        allowsCrossTenantAccess: boolean,
    ): void {
        const tenantProperty = this.metadata.tenantKeyProperty;
        if (!tenantProperty) {
            return;
        }
        if (allowsCrossTenantAccess) {
            return;
        }

        if (tenantId === undefined || tenantId === null) {
            throw new TenantScopeUnavailableError(this.metadata.entityName);
        }

        const values = entity as Record<string, unknown>;
        const current = values[tenantProperty];
        if (current === undefined || current === null || current === '') {
            values[tenantProperty] = tenantId;
            return;
        }

        const tenantMatches = current instanceof Date && tenantId instanceof Date
            ? current.getTime() === tenantId.getTime()
            : current === tenantId;
        if (!tenantMatches) {
            throw new DbValidationError(
                `Entity '${this.metadata.entityName}' tenant key '${tenantProperty}' must match the current tenant scope.`,
            );
        }
    }

    private modificationSql(): ModificationSqlBuilder {
        this.modificationSqlBuilder ??= new ModificationSqlBuilder(this.context.dialect);
        return this.modificationSqlBuilder;
    }
}
