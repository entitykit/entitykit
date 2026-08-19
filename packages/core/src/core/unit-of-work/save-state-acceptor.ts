import type { ChangeTracker } from '../../tracking/change-tracker';
import type { ManyToManyChangeSet } from '../many-to-many-change-set';
import type { ManyToManyChange } from '../many-to-many-change';
import type { SaveTimeWrites } from '../save-time-writes';
import type { PersistedEntrySnapshot } from '../../tracking/persisted-entry-snapshot';
import type { SaveStateAcceptance } from './save-state-acceptance';
import { captureGeneratedRelationshipRollback } from '../../tracking/generated-relationship-rollback-capture';
import { runRestorationActions } from '../../restoration-actions';
import type { RestorationScope } from '../../restoration-scope';

interface SaveStateAcceptorOptions {
    readonly changeTracker: ChangeTracker;
    readonly saveTimeWrites: SaveTimeWrites;
    readonly manyToMany: ManyToManyChangeSet;
    readonly persistedEntries: readonly PersistedEntrySnapshot[];
    readonly manyToManyChanges: readonly ManyToManyChange[];
    readonly rollbackVersions: () => void;
    readonly restoration: RestorationScope;
}

export function acceptSaveState(
    options: SaveStateAcceptorOptions,
): SaveStateAcceptance {
    const rollbackGeneratedRelationships =
        captureGeneratedRelationshipRollback(
            options.changeTracker, options.persistedEntries,
        );
    let rollbackSaveTimeWrites = (): void => {
        options.saveTimeWrites.restore();
    };
    let rollbackManyToMany = (): void => undefined;
    let tracker: ReturnType<ChangeTracker['acceptPersistedChanges']> | undefined;
    try {
        tracker = options.changeTracker.acceptPersistedChanges(
            options.persistedEntries,
            options.restoration,
        );
        rollbackSaveTimeWrites = options.saveTimeWrites.acceptWithRollback();
        rollbackManyToMany = options.manyToMany.accept(
            options.manyToManyChanges,
        );
    } catch (error) {
        options.restoration.capturePrimary(error);
        options.restoration.attemptAll([
            rollbackGeneratedRelationships,
            () => {
                tracker?.rollback();
            },
            options.rollbackVersions,
            rollbackSaveTimeWrites,
            rollbackManyToMany,
        ]);
        throw error;
    }
    return {
        commit: () => {
            tracker.commit();
        },
        rollback: () => {
            rollbackAll([
                rollbackGeneratedRelationships,
                () => {
                    tracker.rollback();
                },
                options.rollbackVersions,
                rollbackSaveTimeWrites,
                rollbackManyToMany,
            ]);
        },
    };
}

function rollbackAll(actions: ReadonlyArray<() => void>): void {
    runRestorationActions(actions);
}
