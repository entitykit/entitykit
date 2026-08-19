import type { EntityMetadata } from '../model/entity-metadata';
import type { DatabaseQueryResult } from '../storage/database-connection';
import type { StoreValueReader } from '../storage/store-value-reader';
import { upsertGeneratedProperties } from '../sql/upsert-property-selection';
import { SaveTimeMutationLog } from './save-time-mutations';
import { applyPreparedGeneratedRow } from './unit-of-work/generated-value-writer';
import type { CapturedBulkUpsertRow } from './bulk-upsert-row';
import type { ChangeTracker } from '../tracking/change-tracker';
import type { GeneratedIdentityRollbackSource } from '../tracking/generated-identity-rollback-source';
import { captureGeneratedRelationshipRollbackTargets } from '../tracking/generated-relationship-rollback-scan';
import { prepareGeneratedRow } from './unit-of-work/prepared-generated-value';
import { generatedRollbackSource } from './unit-of-work/generated-rollback-source';
import { runRestorationActions } from '../restoration-actions';
import type { RestorationScope } from '../restoration-scope';

/** Correlates and journals generated values for one-row upsert statements. */
export class BulkUpsertGeneratedValues<TEntity extends object> {
    private readonly mutations = new SaveTimeMutationLog();
    private readonly properties;
    private readonly rollbackSources: GeneratedIdentityRollbackSource[] = [];

    constructor(
        private readonly metadata: EntityMetadata<TEntity>,
        private readonly scope: RestorationScope,
        private readonly valueReader?: StoreValueReader,
    ) {
        this.properties = upsertGeneratedProperties(metadata);
    }

    public get requiresSingleRow(): boolean {
        return this.properties.length > 0;
    }

    public hydrate(
        row: CapturedBulkUpsertRow<TEntity>,
        result: DatabaseQueryResult,
    ): void {
        if (this.properties.length === 0) {
            return;
        }
        if (result.rows.length === 0) {
            throw new Error(
                `The provider upserted '${this.metadata.entityName}' but did not return its store-generated values.`,
            );
        }
        const returned = result.rows[0];
        const prepared = prepareGeneratedRow(
            this.metadata,
            this.properties,
            returned,
            this.valueReader,
        );
        this.rollbackSources.push(generatedRollbackSource(
            this.metadata,
            row.entity,
            prepared,
            row.providerValues,
        ));
        applyPreparedGeneratedRow(
            row.entity,
            this.metadata,
            prepared,
            this.mutations,
            this.scope,
        );
    }

    public accept(): void {
        this.rollbackSources.length = 0;
        this.mutations.accept();
    }

    public restore(tracker: ChangeTracker): void {
        const sources = this.rollbackSources.splice(0);
        runRestorationActions([
            () => {
                captureGeneratedRelationshipRollbackTargets(
                    tracker, sources,
                );
            },
            this.mutations.restore.bind(this.mutations),
        ]);
    }
}
