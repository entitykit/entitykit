import type { EntityMetadata } from '../model/entity-metadata';
import type { DatabaseQueryResult } from '../storage/database-connection';
import type { StoreValueReader } from '../storage/store-value-reader';
import { upsertGeneratedProperties } from '../sql/upsert-property-selection';
import { SaveTimeMutationLog } from './save-time-mutations';
import { writeGeneratedRow } from './unit-of-work/generated-value-writer';
import type { CapturedBulkUpsertRow } from './bulk-upsert-row';
import type { ChangeTracker } from '../tracking/change-tracker';
import type { GeneratedIdentityRollbackSource } from '../tracking/generated-identity-rollback-source';
import { captureGeneratedRelationshipRollbackTargets } from '../tracking/generated-relationship-rollback-scan';
import { cloneBoundValues } from '../tracking/bound-value-snapshot';
import { cloneSnapshotValue } from '../tracking/snapshot-value-clone';

/** Correlates and journals generated values for one-row upsert statements. */
export class BulkUpsertGeneratedValues<TEntity extends object> {
    private readonly mutations = new SaveTimeMutationLog();
    private readonly properties;
    private readonly rollbackSources: GeneratedIdentityRollbackSource[] = [];

    constructor(
        private readonly metadata: EntityMetadata<TEntity>,
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
        const generated = writeGeneratedRow(
            row.entity,
            this.metadata,
            this.properties,
            returned,
            this.mutations,
            this.valueReader,
        );
        const boundValues = cloneBoundValues(row.providerValues);
        for (const value of generated) {
            boundValues[value.propertyName] = cloneSnapshotValue(
                value.boundValue,
            );
        }
        this.rollbackSources.push({
            entity: row.entity,
            entityType: this.metadata.ctor,
            keyProperties: this.metadata.keyProperties.map(String),
            tenantKeyProperty: this.metadata.tenantKeyProperty,
            generatedProperties: new Set(generated.map(
                value => value.propertyName,
            )),
            boundValues,
        });
    }

    public accept(): void {
        this.rollbackSources.length = 0;
        this.mutations.accept();
    }

    public restore(tracker: ChangeTracker): void {
        try {
            captureGeneratedRelationshipRollbackTargets(
                tracker, this.rollbackSources,
            );
        } finally {
            this.rollbackSources.length = 0;
            this.mutations.restore();
        }
    }
}
