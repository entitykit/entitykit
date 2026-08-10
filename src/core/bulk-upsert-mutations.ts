import type { EntityMetadata } from '../model/entity-metadata';
import type { StoreValueReader } from '../storage/store-value-reader';
import { BulkUpsertGeneratedValues } from './bulk-upsert-generated-values';

/** One rollback journal for every framework-owned mutation in an upsert. */
export class BulkUpsertMutations<TEntity extends object> {
    public readonly generatedValues: BulkUpsertGeneratedValues<TEntity>;
    private readonly tenantRollbacks: Array<() => void> = [];

    constructor(
        metadata: EntityMetadata<TEntity>,
        valueReader?: StoreValueReader,
    ) {
        this.generatedValues = new BulkUpsertGeneratedValues(
            metadata,
            valueReader,
        );
    }

    public recordTenant(rollback: () => void): void {
        this.tenantRollbacks.push(rollback);
    }

    public accept(): void {
        this.generatedValues.accept();
        this.tenantRollbacks.length = 0;
    }

    public restore(): void {
        this.generatedValues.restore();
        for (const rollback of [...this.tenantRollbacks].reverse()) {
            rollback();
        }
        this.tenantRollbacks.length = 0;
    }
}
