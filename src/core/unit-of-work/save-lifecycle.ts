import type { DbContextOptions } from '../context-options/db-context-option-types';
import type {
    OutboxEventBatch,
    OutboxEventTracker,
} from '../outbox-event-tracker';
import type { SavePlanEntry } from '../save-plan';
import type { TransactionCoordinator } from '../transaction-coordinator';
import type { SaveStateAcceptance } from './save-state-acceptance';
import { isTransactionOutcomeUnknown } from '../../storage/transaction-outcome';

export class SaveLifecycle {
    constructor(
        private readonly getOptions: () => DbContextOptions,
        private readonly outboxEvents: OutboxEventTracker,
        private readonly transactionCoordinator: TransactionCoordinator,
    ) {}

    private get options(): DbContextOptions {
        return this.getOptions();
    }

    public async notifySaving(
        initialPlan: readonly SavePlanEntry[],
        rebuildPlan: () => readonly SavePlanEntry[],
    ): Promise<readonly SavePlanEntry[]> {
        let plan = initialPlan;
        for (const interceptor of this.options.saveInterceptors) {
            await interceptor.savingChanges?.({ plan });
            plan = rebuildPlan();
        }
        return plan;
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
        acceptance: SaveStateAcceptance,
    ): Promise<void> {
        const outboxBatches = this.outboxEvents.batchesFor(plan);
        this.outboxEvents.defer(outboxBatches);
        const callback = async (): Promise<void> => {
            acceptance.commit();
            await this.clearOutboxEvents(outboxBatches);
            await this.notifySaved(plan, affectedEntities);
        };

        if (this.transactionCoordinator.depth > 0) {
            this.transactionCoordinator.enqueueAfterCommitCallback(
                callback,
                () => {
                    this.outboxEvents.release(outboxBatches);
                    acceptance.rollback();
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
                durability: isTransactionOutcomeUnknown(error)
                    ? 'unknown'
                    : error !== undefined
                        ? 'failed'
                        : this.transactionCoordinator.depth > 0
                            ? 'pendingTransaction'
                            : 'committed',
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

    private async clearOutboxEvents(
        batches: readonly OutboxEventBatch[],
    ): Promise<void> {
        const outbox = this.options.outbox;
        if (!outbox) {
            return;
        }

        for (const batch of batches) {
            try {
                await outbox.clearEvents(batch.entity, batch.events);
                this.outboxEvents.release([batch]);
            } catch {
                // Clearing an in-memory event list is post-commit observation.
            }
        }
    }
}
