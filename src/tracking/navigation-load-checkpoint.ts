import { runRestorationActions } from '../restoration-actions';
import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import {
    captureEntryLoadedNavigations,
    restoreEntryLoadedNavigations,
} from './entity-entry-navigation-checkpoint';
import {
    acceptNavigationSnapshotValues,
    captureNavigationSnapshotValues,
    type NavigationSnapshotValues,
} from './navigation-snapshot';

interface LoadedEntryCheckpoint {
    readonly entry: EntityEntry<object>;
    readonly loaded: ReadonlyMap<string, string | null>;
    readonly navigations: NavigationSnapshotValues;
}

/** Tracker facts a navigation load may change, with their restorations. */
export interface NavigationLoadCheckpoint {
    restorationActions(): Array<() => void>;
}

/** Capture loaded flags, navigation baselines, and the tracked entity set. */
export function captureNavigationLoadCheckpoint(
    tracker: ChangeTracker,
): NavigationLoadCheckpoint {
    const entries = tracker.entries();
    const checkpoints: LoadedEntryCheckpoint[] = entries.map(entry => ({
        entry,
        loaded: captureEntryLoadedNavigations(entry),
        navigations: captureNavigationSnapshotValues(entry),
    }));
    const tracked: ReadonlySet<object> = new Set(
        entries.map(entry => entry.entity),
    );
    return {
        restorationActions: (): Array<() => void> => [
            ...checkpoints.map(checkpoint => () => {
                restoreEntryCheckpoint(checkpoint);
            }),
            () => {
                detachEntitiesTrackedSince(tracker, tracked);
            },
        ],
    };
}

/** Put one entry's loaded flags and navigation baselines back. */
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
    ]);
}

/** Detach every entity the failed load was the first to track. */
function detachEntitiesTrackedSince(
    tracker: ChangeTracker,
    tracked: ReadonlySet<object>,
): void {
    runRestorationActions(tracker.entries()
        .filter(entry => !tracked.has(entry.entity))
        .map(entry => () => {
            tracker.detach(entry.entity);
        }));
}
