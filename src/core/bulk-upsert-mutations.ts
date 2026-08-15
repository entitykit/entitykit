import type { EntityMetadata } from '../model/entity-metadata';
import type { StoreValueReader } from '../storage/store-value-reader';
import { BulkUpsertGeneratedValues } from './bulk-upsert-generated-values';
import type { ChangeTracker } from '../tracking/change-tracker';

/** One rollback journal for every framework-owned mutation in an upsert. */
export class BulkUpsertMutations<TEntity extends object> {
    public readonly generatedValues: BulkUpsertGeneratedValues<TEntity>;
    private readonly tenantRollbacks: Array<() => void> = [];
    private releaseReservation: () => void = () => undefined;

    constructor(
        metadata: EntityMetadata<TEntity>,
        private readonly changeTracker: ChangeTracker,
        valueReader?: StoreValueReader,
    ) {
        this.generatedValues = new BulkUpsertGeneratedValues(
            metadata,
            valueReader,
        );
    }

    public reserveInputs(release: () => void): void {
        this.releaseReservation = release;
    }

    public recordTenant(rollback: () => void): void {
        this.tenantRollbacks.push(rollback);
    }

    public accept(): void {
        try {
            this.generatedValues.accept();
            this.tenantRollbacks.length = 0;
        } finally {
            this.releaseReservation();
        }
    }

    public restore(): void {
        const failures: unknown[] = [];
        try {
            this.generatedValues.restore(this.changeTracker);
        } catch (error) {
            failures.push(error);
        }
        for (const rollback of [...this.tenantRollbacks].reverse()) {
            try {
                rollback();
            } catch (error) {
                failures.push(error);
            }
        }
        this.tenantRollbacks.length = 0;
        try {
            this.releaseReservation();
        } catch (error) {
            failures.push(error);
        }
        if (failures.length > 0) {
            throw failures[0];
        }
    }

    public restoreAfterFailure(
        markStateRestorationFailure: (cause: unknown) => void,
    ): void {
        try {
            this.restore();
        } catch (error) {
            markStateRestorationFailure(error);
        }
    }
}
