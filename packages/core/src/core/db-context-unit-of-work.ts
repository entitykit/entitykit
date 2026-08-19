import type { SavePlanEntry } from './save-plan';
import { SavePlanBuilder } from './save-plan-builder';
import { SaveTimeWrites } from './save-time-writes';
import { TransactionCoordinator } from './transaction-coordinator';
import { UnitOfWorkSaver } from './unit-of-work-saver';
import { DbContextRelationships } from './db-context-relationships';
import { OutboxEventTracker } from './outbox-event-tracker';
import type { DatabaseOperationOptions, TransactionOptions } from '../storage/database-connection';
import { ContextConcurrentOperationError } from '../errors/runtime-errors';
import { throwIfOperationAborted } from '../storage/operation-cancellation';
import { RestorationScope } from '../restoration-scope';
import { inspectSavePlan } from './save-plan-inspection';
/** Save planning, persistence, and transaction ownership for a context. */
export abstract class DbContextUnitOfWork extends DbContextRelationships {
    private saveInProgress = false;
    private readonly outboxEvents = new OutboxEventTracker();
    private readonly saveTimeWrites = new SaveTimeWrites({
        now: () => this.currentAuditTimestamp(),
        currentUserId: () => this.currentAuditUserId(),
        currentTenantId: () => this.currentTenantId(),
        allowsCrossTenantAccess: () =>
            this.options.tenantScope?.allowCrossTenantAccess === true,
    });
    private readonly transactionCoordinator = new TransactionCoordinator(
        () => this.databaseConnection,
        (phase, error) => {
            this.state.markStateRestorationFailure(phase, error);
        },
    );
    private readonly savePlanBuilder = new SavePlanBuilder({
        changeTracker: this.changeTracker,
        manyToMany: this.manyToMany,
        outboxEvents: this.outboxEvents,
        saveTimeWrites: this.saveTimeWrites,
        getDialect: () => this.dialect,
        getOptions: () => this.options,
        currentAuditTimestamp: () => this.currentAuditTimestamp(),
    });
    private readonly saver = new UnitOfWorkSaver({
        changeTracker: this.changeTracker,
        saveTimeWrites: this.saveTimeWrites,
        manyToMany: this.manyToMany,
        outboxEvents: this.outboxEvents,
        transactionCoordinator: this.transactionCoordinator,
        navigationLoader: this,
        getDatabase: () => this.databaseConnection,
        getOptions: () => this.options,
    });
    protected get transactionDepth(): number {
        return this.transactionCoordinator.depth;
    }
    protected registerTransactionState(
        afterCommit: () => void,
        afterRollback: () => void,
    ): void {
        if (this.transactionCoordinator.depth === 0) {
            afterCommit();
            return;
        }
        this.transactionCoordinator.enqueueAfterCommitCallback(
            afterCommit,
            afterRollback,
        );
    }
    public getSavePlan(): readonly SavePlanEntry[] {
        this.assertContextUsable('getSavePlan()');
        this.assertSaveNotInProgress('getSavePlan()');
        return inspectSavePlan(
            this.state.markStateRestorationFailure.bind(
                this.state, 'rollback',
            ),
            this.saveTimeWrites,
            restoration => this.savePlanBuilder.build(restoration),
        );
    }
    public getSavePlanDebugView(): string {
        this.assertContextUsable('getSavePlanDebugView()');
        this.assertSaveNotInProgress('getSavePlanDebugView()');
        return inspectSavePlan(
            this.state.markStateRestorationFailure.bind(
                this.state, 'rollback',
            ),
            this.saveTimeWrites,
            restoration => this.savePlanBuilder.debugView(restoration),
        );
    }
    public clearChanges(): void {
        this.assertContextUsable('clearChanges()');
        this.assertSaveNotInProgress('clearChanges()');
        this.changeTracker.clear();
        this.manyToMany.clear();
    }
    public async saveChanges(options?: DatabaseOperationOptions): Promise<number> {
        this.assertContextUsable('saveChanges()');
        throwIfOperationAborted(options?.signal);
        if (this.saveInProgress) {
            throw new ContextConcurrentOperationError(
                'saveChanges()',
                'A saveChanges() is already in progress on this DbContext. Await the first one, or use a separate context per concurrent unit of work.',
            );
        }
        const restoration = new RestorationScope(
            this.state.markStateRestorationFailure.bind(this.state, 'rollback'),
        );
        try {
            const plan = this.savePlanBuilder.build(restoration);
            if (plan.length === 0) {
                restoration.attempt(
                    this.saveTimeWrites.restore.bind(this.saveTimeWrites),
                );
                restoration.throwIfFailed();
                return 0;
            }
            this.saveInProgress = true;
            const affected = await this.saver.run(
                plan,
                () => this.savePlanBuilder.build(
                    restoration,
                    { continueSaveAttempt: true },
                ),
                restoration,
                options,
            );
            restoration.throwIfFailed();
            return affected;
        } catch (error) {
            restoration.capturePrimary(error);
            return restoration.rethrowPrimary();
        } finally {
            this.saveInProgress = false;
        }
    }
    public async transaction<TResult>(
        work: (context: this) => TResult | Promise<TResult>,
        options?: TransactionOptions,
    ): Promise<TResult> {
        this.assertContextUsable('transaction()');
        return this.transactionCoordinator.run(async () => work(this), options);
    }

    private assertSaveNotInProgress(operation: string): void {
        if (this.saveInProgress) {
            throw new ContextConcurrentOperationError(
                operation,
                `${operation} cannot run while saveChanges() is in progress. Await the save before inspecting or clearing its unit of work.`,
            );
        }
    }
}
