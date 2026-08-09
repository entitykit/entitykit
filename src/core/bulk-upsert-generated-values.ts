import type { EntityMetadata } from '../model/entity-metadata';
import type { DatabaseQueryResult } from '../storage/database-connection';
import type { StoreValueReader } from '../storage/store-value-reader';
import { upsertGeneratedProperties } from '../sql/upsert-property-selection';
import { SaveTimeMutationLog } from './save-time-mutations';
import { writeGeneratedRow } from './unit-of-work/generated-value-writer';
import type { CapturedBulkUpsertRow } from './bulk-upsert-row';

/** Correlates and journals generated values for one-row upsert statements. */
export class BulkUpsertGeneratedValues<TEntity extends object> {
    private readonly mutations = new SaveTimeMutationLog();
    private readonly properties;

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
        writeGeneratedRow(
            row.entity,
            this.metadata,
            this.properties,
            returned,
            this.mutations,
            this.valueReader,
        );
    }

    public accept(): void {
        this.mutations.accept();
    }

    public restore(): void {
        this.mutations.restore();
    }
}
