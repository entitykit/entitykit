import type { OutboxMessage } from './outbox-options';
import type { SavePlanEntry } from './save-plan';

export interface OutboxEventBatch {
    readonly entity: object;
    readonly events: readonly OutboxMessage[];
}

/**
 * Outbox events written by saves whose explicit transaction has not completed.
 *
 * Plan associations are weak and save-local. Deferred event identities are
 * context-local, so later saves skip only events this context already wrote.
 */
export class OutboxEventTracker {
    private readonly batchesByPlanEntry: WeakMap<SavePlanEntry, readonly OutboxEventBatch[]> =
        new WeakMap();
    private readonly deferredByEntity: WeakMap<object, Set<OutboxMessage>> =
        new WeakMap();

    public pending(
        entity: object,
        events: readonly OutboxMessage[],
    ): readonly OutboxMessage[] {
        const deferred = this.deferredByEntity.get(entity);
        return deferred
            ? events.filter(event => !deferred.has(event))
            : [...events];
    }

    public associate(
        entry: SavePlanEntry,
        batches: readonly OutboxEventBatch[],
    ): void {
        this.batchesByPlanEntry.set(entry, batches);
    }

    public batchesFor(plan: readonly SavePlanEntry[]): readonly OutboxEventBatch[] {
        return plan.flatMap(entry => this.batchesByPlanEntry.get(entry) ?? []);
    }

    public defer(batches: readonly OutboxEventBatch[]): void {
        for (const batch of batches) {
            let deferred = this.deferredByEntity.get(batch.entity);
            if (!deferred) {
                deferred = new Set();
                this.deferredByEntity.set(batch.entity, deferred);
            }
            for (const event of batch.events) {
                deferred.add(event);
            }
        }
    }

    public release(batches: readonly OutboxEventBatch[]): void {
        for (const batch of batches) {
            const deferred = this.deferredByEntity.get(batch.entity);
            if (!deferred) {
                continue;
            }
            for (const event of batch.events) {
                deferred.delete(event);
            }
            if (deferred.size === 0) {
                this.deferredByEntity.delete(batch.entity);
            }
        }
    }
}
