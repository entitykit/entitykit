import { runRestorationActions } from '../restoration-actions';
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

/** One entry's tracker facts as they stood before a load changed them. */
export interface LoadedEntryCheckpoint {
    readonly entry: EntityEntry<object>;
    readonly loaded: ReadonlyMap<string, string | null>;
    readonly navigations: NavigationSnapshotValues;
    readonly suppressed: ReadonlySet<string>;
}

/** Capture one entry's loaded flags, navigation baselines, and suppression. */
export function captureEntryCheckpoint(
    entry: EntityEntry<object>,
): LoadedEntryCheckpoint {
    return {
        entry,
        loaded: captureEntryLoadedNavigations(entry),
        navigations: captureNavigationSnapshotValues(entry),
        suppressed: captureNavigationChangeDetectionState(entry),
    };
}

/** Put one entry's loaded flags, baselines, and suppression back. */
export function restoreEntryCheckpoint(
    checkpoint: LoadedEntryCheckpoint,
): void {
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
