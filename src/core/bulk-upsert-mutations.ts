import type { EntityMetadata } from '../model/entity-metadata';
import type { StoreValueReader } from '../storage/store-value-reader';
import { BulkUpsertGeneratedValues } from './bulk-upsert-generated-values';
import type { ChangeTracker } from '../tracking/change-tracker';
import {
    associatedRestorationFailures,
    restorationFailureFrom,
    runRestorationActions,
} from './restoration-failures';

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
        const tenantRollbacks = [...this.tenantRollbacks].reverse();
        this.tenantRollbacks.length = 0;
        runRestorationActions([
            () => {
                this.generatedValues.restore(this.changeTracker);
            },
            ...tenantRollbacks,
            this.releaseReservation,
        ]);
    }

    public restoreAfterFailure(
        operationError: unknown,
        markStateRestorationFailure: (cause: unknown) => void,
    ): void {
        const failure = restorationFailureFrom(
            [this.restore.bind(this)],
            associatedRestorationFailures(operationError),
        );
        if (failure !== undefined) markStateRestorationFailure(failure);
    }
}
