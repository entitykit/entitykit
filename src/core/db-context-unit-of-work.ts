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
        this.assertSaveNotInProgress('getSavePlan()');
        try {
            return this.savePlanBuilder.build();
        } finally {
            this.saveTimeWrites.restore();
        }
    }

    public getSavePlanDebugView(): string {
        this.assertSaveNotInProgress('getSavePlanDebugView()');
        try {
            return this.savePlanBuilder.debugView();
        } finally {
            this.saveTimeWrites.restore();
        }
    }

    public clearChanges(): void {
        this.assertSaveNotInProgress('clearChanges()');
        this.changeTracker.clear();
        this.manyToMany.clear();
    }

    public async saveChanges(options?: DatabaseOperationOptions): Promise<number> {
        this.assertNotDisposed('saveChanges()');
        throwIfOperationAborted(options?.signal);
        if (this.saveInProgress) {
            throw new ContextConcurrentOperationError(
                'saveChanges()',
                'A saveChanges() is already in progress on this DbContext. Await the first one, or use a separate context per concurrent unit of work.',
            );
        }

        const plan = this.savePlanBuilder.build();
        if (plan.length === 0) {
            this.saveTimeWrites.restore();
            return 0;
        }

        this.saveInProgress = true;
        try {
            return await this.saver.run(
                plan,
                () => this.savePlanBuilder.build({ continueSaveAttempt: true }),
                options,
            );
        } finally {
            this.saveInProgress = false;
        }
    }

    public async transaction<TResult>(
        work: (context: this) => TResult | Promise<TResult>,
        options?: TransactionOptions,
    ): Promise<TResult> {
        this.assertNotDisposed('transaction()');
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
