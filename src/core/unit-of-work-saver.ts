import { mapDatabaseProviderError } from '../errors/db-update-error';
import type { SavePlanEntry } from './save-plan';
import { SaveLifecycle } from './unit-of-work/save-lifecycle';
import { SavePlanExecutor } from './unit-of-work/save-plan-executor';
import { TrackedSaveState } from './unit-of-work/tracked-save-state';
import type { UnitOfWorkSaverDeps } from './unit-of-work/unit-of-work-saver-deps';
import type { DatabaseOperationOptions } from '../storage/database-connection';
import { startElapsedTimer } from '../diagnostics/runtime/elapsed-time';
import type { SaveStateAcceptance } from './unit-of-work/save-state-acceptance';
import {
    associateRestorationFailure,
    associatedRestorationFailures,
    restorationFailureFrom,
    runRestorationActions,
} from './restoration-failures';

export type { UnitOfWorkSaverDeps } from './unit-of-work/unit-of-work-saver-deps';

export class UnitOfWorkSaver {
    private readonly executor: SavePlanExecutor;
    private readonly lifecycle: SaveLifecycle;
    private readonly trackedState: TrackedSaveState;
    private readonly markStateRestorationFailure: (error: unknown) => void;

    constructor(deps: UnitOfWorkSaverDeps) {
        this.executor = new SavePlanExecutor(
            deps.getDatabase,
            () => deps.getOptions().dialect,
            () => deps.getOptions().valueReader,
            deps.changeTracker,
            deps.navigationLoader,
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
        this.markStateRestorationFailure =
            deps.markStateRestorationFailure;
    }

    public async run(
        previewPlan: readonly SavePlanEntry[],
        rebuildPlan: () => readonly SavePlanEntry[],
        options?: DatabaseOperationOptions,
    ): Promise<number> {
        const elapsed = startElapsedTimer();
        let plan: readonly SavePlanEntry[];
        try {
            plan = await this.lifecycle.notifySaving(previewPlan, rebuildPlan);
            this.trackedState.validateVersionValues(plan);
        } catch (error) {
            this.restoreAfterFailure(error, [
                this.trackedState.restoreSaveTimeWrites.bind(this.trackedState),
            ]);
            throw error;
        }

        if (plan.length === 0) {
            this.restoreWithoutPrimaryFailure([
                this.trackedState.restoreSaveTimeWrites.bind(this.trackedState),
            ]);
            return 0;
        }

        let affectedEntities: number;
        let acceptance: SaveStateAcceptance | undefined;
        try {
            affectedEntities = await this.executor.run(plan, () => {
                const generatedValues = this.executor.acceptGeneratedValues();
                try {
                    const tracked = this.trackedState.accept(
                        plan,
                        generatedValues.values,
                    );
                    acceptance = {
                        commit: () => {
                            tracked.commit();
                        },
                        rollback: () => {
                            runRestorationActions([
                                () => {
                                    tracked.rollback();
                                },
                                generatedValues.rollback,
                            ]);
                        },
                    };
                } catch (error) {
                    const failure = restorationFailureFrom([
                        generatedValues.rollback,
                    ]);
                    if (failure !== undefined) {
                        associateRestorationFailure(error, failure);
                    }
                    throw error;
                }
            }, options);
        } catch (error) {
            this.restoreAfterFailure(error, [
                () => {
                    acceptance?.rollback();
                },
                this.executor.restoreGeneratedValues.bind(this.executor),
                this.trackedState.restoreSaveTimeWrites.bind(this.trackedState),
            ]);
            const mappedError = mapDatabaseProviderError(error);
            await this.lifecycle.notifyFailed(plan, mappedError);
            this.lifecycle.emitDiagnostic(plan, elapsed(), undefined, mappedError);
            throw mappedError;
        }

        if (!acceptance) {
            throw new Error('Save state was not accepted before commit.');
        }
        await this.lifecycle.afterCommitted(plan, affectedEntities, acceptance);
        this.lifecycle.emitDiagnostic(plan, elapsed(), affectedEntities);
        return affectedEntities;
    }

    private restoreAfterFailure(
        operationError: unknown,
        actions: ReadonlyArray<() => void>,
    ): void {
        const failure = restorationFailureFrom(
            actions,
            associatedRestorationFailures(operationError),
        );
        if (failure !== undefined) {
            this.markStateRestorationFailure(failure);
        }
    }

    private restoreWithoutPrimaryFailure(
        actions: ReadonlyArray<() => void>,
    ): void {
        const failure = restorationFailureFrom(actions);
        if (failure === undefined) return;
        this.markStateRestorationFailure(failure);
        throw failure;
    }
}
