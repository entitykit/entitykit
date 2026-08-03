import { mapDatabaseProviderError } from '../errors/db-update-error';
import type { SavePlanEntry } from './save-plan';
import { SaveLifecycle } from './unit-of-work/save-lifecycle';
import { SavePlanExecutor } from './unit-of-work/save-plan-executor';
import { TrackedSaveState } from './unit-of-work/tracked-save-state';
import type { UnitOfWorkSaverDeps } from './unit-of-work/unit-of-work-saver-deps';
import type { DatabaseOperationOptions } from '../storage/database-connection';
import { startElapsedTimer } from '../diagnostics/runtime/elapsed-time';

export type { UnitOfWorkSaverDeps } from './unit-of-work/unit-of-work-saver-deps';

export class UnitOfWorkSaver {
    private readonly executor: SavePlanExecutor;
    private readonly lifecycle: SaveLifecycle;
    private readonly trackedState: TrackedSaveState;

    constructor(deps: UnitOfWorkSaverDeps) {
        this.executor = new SavePlanExecutor(
            deps.getDatabase,
            () => deps.getOptions().dialect,
            () => deps.getOptions().valueReader,
            deps.changeTracker,
        );
        this.lifecycle = new SaveLifecycle(
            deps.getOptions,
            deps.outboxEvents,
            deps.transactionCoordinator,
        );
        this.trackedState = new TrackedSaveState(
            deps.changeTracker,
            deps.saveTimeWrites,
            deps.manyToMany,
        );
    }

    public async run(
        previewPlan: readonly SavePlanEntry[],
        rebuildPlan: () => readonly SavePlanEntry[],
        options?: DatabaseOperationOptions,
    ): Promise<number> {
        const elapsed = startElapsedTimer();
        let plan: readonly SavePlanEntry[];
        try {
            await this.lifecycle.notifySaving(previewPlan);
            plan = rebuildPlan();
            this.trackedState.validateVersionValues(plan);
        } catch (error) {
            this.trackedState.restoreSaveTimeWrites();
            throw error;
        }

        if (plan.length === 0) {
            this.trackedState.restoreSaveTimeWrites();
            return 0;
        }

        try {
            const affectedEntities = await this.executor.run(plan, options);
            this.trackedState.accept(plan);
            this.executor.acceptGeneratedValues();
            await this.lifecycle.afterCommitted(plan, affectedEntities);
            this.lifecycle.emitDiagnostic(plan, elapsed(), affectedEntities);
            return affectedEntities;
        } catch (error) {
            this.executor.restoreGeneratedValues();
            this.trackedState.restoreSaveTimeWrites();
            const mappedError = mapDatabaseProviderError(error);
            await this.lifecycle.notifyFailed(plan, mappedError);
            this.lifecycle.emitDiagnostic(plan, elapsed(), undefined, mappedError);
            throw mappedError;
        }
    }
}
