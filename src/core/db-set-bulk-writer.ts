import type { EntityConstructor } from '../types';
import type { DbSetContext } from './db-set-context';
import type { EntityMetadata } from '../model/entity-metadata';
import { ModificationSqlBuilder, type UpsertSqlOptions } from '../sql/modification-sql-builder';
import type { DbSetDiagnostics } from './db-set-diagnostics';
import type { DatabaseOperationOptions } from '../storage/database-connection';
import {
    applyBulkWriteTenant,
    assertBulkWriteTenantProviderValues,
    captureBulkWriteTenantProviderValue,
} from './bulk-write-tenant';
import { executeBulkUpsertBatches } from './bulk-upsert-batch-executor';
import {
    captureBulkUpsertRow,
    type CapturedBulkUpsertRow,
} from './bulk-upsert-row';
import { upsertInsertProperties } from '../sql/upsert-property-selection';
import { assertBulkUpsertInputs } from './bulk-upsert-input-validation';
import { BulkUpsertMutations } from './bulk-upsert-mutations';
import { captureBulkUpsertOptions } from './capture-bulk-upsert-options';

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
        const inputs = Object.freeze([...entities]);
        if (inputs.length === 0) {
            return 0;
        }
        const capturedOptions = captureBulkUpsertOptions(options);
        assertBulkUpsertInputs(
            this.metadata,
            this.context.changeTracker,
            inputs,
        );
        const mutations = new BulkUpsertMutations(
            this.metadata,
            this.context.changeTracker,
            this.context.valueReader,
        );
        mutations.reserveInputs(
            this.context.changeTracker.reserveUntrackedEntities(inputs),
        );
        try {
            const allowsCrossTenantAccess = this.context.allowsCrossTenantAccess();
            const tenantMatchProperty = allowsCrossTenantAccess
                ? undefined
                : this.metadata.tenantKeyProperty;
            const tenantId = tenantMatchProperty
                ? this.context.currentTenantIdForWrites()
                : undefined;
            const providerTenantId = captureBulkWriteTenantProviderValue(
                this.metadata, tenantId, allowsCrossTenantAccess,
            );
            const generatedValues = mutations.generatedValues;
            const rows: Array<CapturedBulkUpsertRow<TEntity>> = [];
            for (const entity of inputs) {
                mutations.recordTenant(applyBulkWriteTenant(
                    this.metadata,
                    entity,
                    tenantId,
                    allowsCrossTenantAccess,
                ));
                const row = captureBulkUpsertRow(this.metadata, entity);
                assertBulkWriteTenantProviderValues(this.metadata,
                    row.providerValues, providerTenantId,
                    allowsCrossTenantAccess);
                rows.push(row);
            }
            const sql = this.modificationSql();
            const parametersPerRow = Math.max(
                upsertInsertProperties(this.metadata).length,
                1,
            );
            const limit = this.context.options.dialect
                .maxStatementParameters?.();
            const parameterBatchSize = limit === undefined
                ? rows.length
                : Math.max(Math.floor(limit / parametersPerRow), 1);
            const batchSize = generatedValues.requiresSingleRow
                ? 1
                : parameterBatchSize;
            // Always enter the connection transaction API. Inside an explicit
            // context transaction this becomes a savepoint, so a caught
            // later-batch failure cannot leave earlier batches committed.
            const affected = await executeBulkUpsertBatches({
                context: this.context,
                metadata: this.metadata,
                diagnostics: this.diagnostics,
                sql,
                rows,
                options: capturedOptions,
                tenantMatchProperty,
                batchSize,
                generatedValues,
            });
            this.context.registerTransactionState(
                mutations.accept.bind(mutations),
                mutations.restore.bind(mutations),
            );
            return affected;
        } catch (error) {
            mutations.restoreAfterFailure(cause => {
                this.context.markStateRestorationFailure(cause);
            });
            throw error;
        }
    }
    private modificationSql(): ModificationSqlBuilder {
        this.modificationSqlBuilder ??= new ModificationSqlBuilder(this.context.dialect);
        return this.modificationSqlBuilder;
    }
}
