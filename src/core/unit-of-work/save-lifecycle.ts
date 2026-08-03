import type { DbContextOptions } from '../context-options/db-context-option-types';
import type {
    OutboxEventBatch,
    OutboxEventTracker,
} from '../outbox-event-tracker';
import type { SavePlanEntry } from '../save-plan';
import type { TransactionCoordinator } from '../transaction-coordinator';

export class SaveLifecycle {
    constructor(
        private readonly getOptions: () => DbContextOptions,
        private readonly outboxEvents: OutboxEventTracker,
        private readonly transactionCoordinator: TransactionCoordinator,
    ) {}

    private get options(): DbContextOptions {
        return this.getOptions();
    }

    public async notifySaving(plan: readonly SavePlanEntry[]): Promise<void> {
        for (const interceptor of this.options.saveInterceptors) {
            await interceptor.savingChanges?.({ plan });
        }
    }

    public async notifyFailed(plan: readonly SavePlanEntry[], error: unknown): Promise<void> {
        for (const interceptor of this.options.saveInterceptors) {
            try {
                await interceptor.saveChangesFailed?.({ plan, error });
            } catch {
                // A failure observer cannot replace the provider failure it observes.
            }
        }
    }

    public async afterCommitted(
        plan: readonly SavePlanEntry[],
        affectedEntities: number,
    ): Promise<void> {
        const outboxBatches = this.outboxEvents.batchesFor(plan);
        this.outboxEvents.defer(outboxBatches);
        const callback = async (): Promise<void> => {
            this.clearOutboxEvents(outboxBatches);
            await this.notifySaved(plan, affectedEntities);
        };

        if (this.transactionCoordinator.depth > 0) {
            this.transactionCoordinator.enqueueAfterCommitCallback(
                callback,
                () => {
                    this.outboxEvents.release(outboxBatches);
                },
            );
            return;
        }

        await callback();
    }

    public emitDiagnostic(
        plan: readonly SavePlanEntry[],
        durationMs: number,
        affectedEntities?: number,
        error?: unknown,
    ): void {
        for (const handler of this.options.diagnostics) {
            handler({
                kind: 'saveChanges',
                provider: this.options.provider.provider,
                plan,
                durationMs,
                affectedEntities,
                error,
            });
        }
    }

    private async notifySaved(
        plan: readonly SavePlanEntry[],
        affectedEntities: number,
    ): Promise<void> {
        for (const interceptor of this.options.saveInterceptors) {
            try {
                await interceptor.savedChanges?.({ plan, affectedEntities });
            } catch {
                // The database is committed; observer failures cannot undo it.
            }
        }
    }

    private clearOutboxEvents(batches: readonly OutboxEventBatch[]): void {
        const clearEvents = this.options.outbox?.clearEvents;
        if (!clearEvents) {
            this.outboxEvents.release(batches);
            return;
        }

        for (const batch of batches) {
            try {
                clearEvents(batch.entity, batch.events);
            } catch {
                // Clearing an in-memory event list is post-commit observation.
            } finally {
                this.outboxEvents.release([batch]);
            }
        }
    }
}
