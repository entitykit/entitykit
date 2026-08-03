import type { ChangeTracker } from '../../tracking/change-tracker';
import type { ManyToManyChangeSet } from '../many-to-many-change-set';
import type { ManyToManyChange } from '../many-to-many-change';
import type { SaveTimeWrites } from '../save-time-writes';
import type { PersistedEntrySnapshot } from '../../tracking/persisted-entry-snapshot';
import type { SaveStateAcceptance } from './save-state-acceptance';

interface SaveStateAcceptorOptions {
    readonly changeTracker: ChangeTracker;
    readonly saveTimeWrites: SaveTimeWrites;
    readonly manyToMany: ManyToManyChangeSet;
    readonly persistedEntries: readonly PersistedEntrySnapshot[];
    readonly manyToManyChanges: readonly ManyToManyChange[];
    readonly rollbackVersions: () => void;
}

export function acceptSaveState(
    options: SaveStateAcceptorOptions,
): SaveStateAcceptance {
    let rollbackSaveTimeWrites = (): void => {
        options.saveTimeWrites.restore();
    };
    let rollbackManyToMany = (): void => undefined;
    let tracker: ReturnType<ChangeTracker['acceptPersistedChanges']> | undefined;
    try {
        tracker = options.changeTracker.acceptPersistedChanges(
            options.persistedEntries,
        );
        rollbackSaveTimeWrites = options.saveTimeWrites.acceptWithRollback();
        rollbackManyToMany = options.manyToMany.accept(
            options.manyToManyChanges,
        );
    } catch (error) {
        tracker?.rollback();
        options.rollbackVersions();
        rollbackSaveTimeWrites();
        rollbackManyToMany();
        throw error;
    }
    return {
        commit: () => {
            tracker.commit();
        },
        rollback: () => {
            tracker.rollback();
            options.rollbackVersions();
            rollbackSaveTimeWrites();
            rollbackManyToMany();
        },
    };
}
