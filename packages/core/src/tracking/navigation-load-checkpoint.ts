import { runRestorationActions } from '../restoration-actions';
import type { EntityEntry } from './entity-entry';
import {
    captureEntryLoadedNavigations,
    restoreEntryLoadedNavigations,
} from './entity-entry-navigation-checkpoint';
import {
    allowNavigationChangeDetection,
    navigationChangeDetectionAllowed,
    suppressNavigationChangeDetection,
} from './navigation-change-detection-state';
import {
    acceptNavigationSnapshotValues,
    captureNavigationSnapshotValues,
    navigationSnapshot,
} from './navigation-snapshot';

/**
 * One navigation's tracker facts as they stood before a load changed them.
 *
 * The checkpoint is per navigation property, never per entry: a load stitching
 * `doc.owner` is entitled to hand back what it found about `doc.owner`, and to
 * nothing else `doc` happens to know. `loadedKnown` and `snapshotKnown` keep
 * "this property had no fact" distinct from "this property held null", which
 * both underlying maps encode as an absent key rather than a stored one.
 */
export interface LoadedNavigationCheckpoint {
    readonly entry: EntityEntry<object>;
    readonly property: string;
    readonly loadedKnown: boolean;
    readonly loadedValue: string | null | undefined;
    readonly snapshotKnown: boolean;
    readonly snapshotValue: unknown;
    readonly suppressed: boolean;
}

/** Capture one navigation's loaded flag, baseline, and suppression. */
export function captureNavigationCheckpoint(
    entry: EntityEntry<object>,
    property: string,
): LoadedNavigationCheckpoint {
    const loaded = captureEntryLoadedNavigations(entry);
    const snapshot = navigationSnapshot(entry, property);
    return {
        entry,
        property,
        loadedKnown: loaded.has(property),
        loadedValue: loaded.get(property),
        snapshotKnown: snapshot.known,
        snapshotValue: snapshot.value,
        suppressed: !navigationChangeDetectionAllowed(entry, property),
    };
}

/**
 * Put one navigation's facts back without disturbing any other property.
 *
 * Every restore merges into the *current* maps rather than replacing them, so
 * facts that legitimately advanced while the load was in flight -- another
 * navigation loaded, moved, accepted -- survive a rollback that has nothing to
 * say about them. Restores for different properties of the same entry compose
 * in any order because each reads the live map and rewrites one slot of it.
 */
export function restoreNavigationCheckpoint(
    checkpoint: LoadedNavigationCheckpoint,
): void {
    runRestorationActions([
        (): void => {
            restoreLoadedFlag(checkpoint);
        },
        (): void => {
            restoreNavigationBaseline(checkpoint);
        },
        (): void => {
            restoreSuppression(checkpoint);
        },
    ]);
}

/** Rewrite this property's slot of the entry's loaded-navigation map. */
function restoreLoadedFlag(checkpoint: LoadedNavigationCheckpoint): void {
    const { entry, property } = checkpoint;
    const current = new Map(captureEntryLoadedNavigations(entry));
    if (checkpoint.loadedKnown) {
        current.set(property, checkpoint.loadedValue ?? null);
    } else {
        current.delete(property);
    }
    restoreEntryLoadedNavigations(entry, current);
}

/** Rewrite this property's slot of the entry's navigation baselines. */
function restoreNavigationBaseline(
    checkpoint: LoadedNavigationCheckpoint,
): void {
    const { entry, property } = checkpoint;
    const current = new Map(captureNavigationSnapshotValues(entry));
    if (checkpoint.snapshotKnown) {
        current.set(property, checkpoint.snapshotValue);
    } else {
        current.delete(property);
    }
    acceptNavigationSnapshotValues(entry, current);
}

/** Rewrite this property's change-detection suppression and no other. */
function restoreSuppression(checkpoint: LoadedNavigationCheckpoint): void {
    const { entry, property } = checkpoint;
    if (checkpoint.suppressed) {
        suppressNavigationChangeDetection(entry, property);
        return;
    }
    allowNavigationChangeDetection(entry, property);
}
