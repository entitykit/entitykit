import { runRestorationActions } from '../restoration-actions';
import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import {
    captureEntryLoadedNavigations,
    restoreEntryLoadedNavigations,
} from './entity-entry-navigation-checkpoint';
import {
    captureNavigationChangeDetectionState,
    restoreNavigationChangeDetectionState,
} from './navigation-change-detection-state';
import {
    acceptNavigationSnapshotValues,
    captureNavigationSnapshotValues,
    type NavigationSnapshotValues,
} from './navigation-snapshot';

interface LoadedEntryCheckpoint {
    readonly entry: EntityEntry<object>;
    readonly loaded: ReadonlyMap<string, string | null>;
    readonly navigations: NavigationSnapshotValues;
    readonly suppressed: ReadonlySet<string>;
}

/** Tracker facts a navigation load may change, with their restorations. */
export interface NavigationLoadCheckpoint {
    /** Record an entity this load was the first to track. */
    recordTrackedByLoad(entity: object): void;
    restorationActions(): Array<() => void>;
}

/** Capture loaded flags, navigation baselines, and suppression per entry. */
export function captureNavigationLoadCheckpoint(
    tracker: ChangeTracker,
): NavigationLoadCheckpoint {
    const checkpoints: LoadedEntryCheckpoint[] = tracker.entries().map(entry => ({
        entry,
        loaded: captureEntryLoadedNavigations(entry),
        navigations: captureNavigationSnapshotValues(entry),
        suppressed: captureNavigationChangeDetectionState(entry),
    }));
    const trackedByLoad: Set<object> = new Set();
    return {
        recordTrackedByLoad: (entity: object): void => {
            trackedByLoad.add(entity);
        },
        restorationActions: (): Array<() => void> => [
            ...checkpoints.map(checkpoint => () => {
                restoreEntryCheckpoint(checkpoint);
            }),
            () => {
                detachEntitiesTrackedByLoad(tracker, trackedByLoad);
            },
        ],
    };
}

/** Put one entry's loaded flags, baselines, and suppression back. */
function restoreEntryCheckpoint(checkpoint: LoadedEntryCheckpoint): void {
    runRestorationActions([
        () => {
            restoreEntryLoadedNavigations(checkpoint.entry, checkpoint.loaded);
        },
        () => {
            acceptNavigationSnapshotValues(
                checkpoint.entry, checkpoint.navigations,
            );
        },
        () => {
            restoreNavigationChangeDetectionState(
                checkpoint.entry, checkpoint.suppressed,
            );
        },
    ]);
}

/** Detach exactly the entities this load recorded as freshly tracked. */
function detachEntitiesTrackedByLoad(
    tracker: ChangeTracker,
    trackedByLoad: ReadonlySet<object>,
): void {
    runRestorationActions([...trackedByLoad].map(entity => () => {
        tracker.detach(entity);
    }));
}
