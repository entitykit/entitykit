import type { EntityEntry } from './entity-entry';
import {
    captureEntryLoadedNavigations,
} from './entity-entry-navigation-checkpoint';
import {
    captureNavigationChangeDetectionState,
} from './navigation-change-detection-state';
import {
    captureNavigationSnapshotValues,
    navigationValueChanged,
} from './navigation-snapshot';
import type { OwnedEntryCheckpoint } from './navigation-load-ownership-checkpoint';

/**
 * Compare the graph and tracker facts of one owned entry against its capture.
 *
 * Every comparison here is read-only and identity-based, and collections are
 * compared the way a navigation write is: same length, same elements, same
 * order. That is deliberate rather than lenient. A rolled-back journal write
 * hands back a *copy* of the container it captured, so the array standing on
 * the entity after restoration is never the one the checkpoint holds -- only
 * element identity can say the load's own write was fully unwound.
 */
export function ownedNavigationFactsMatch(
    entry: EntityEntry<object>,
    checkpoint: OwnedEntryCheckpoint,
): boolean {
    return navigationValuesMatch(entry, checkpoint)
        && containersMatch(
            captureNavigationSnapshotValues(entry), checkpoint.baselines,
        )
        && loadedMatch(
            captureEntryLoadedNavigations(entry), checkpoint.loaded,
        )
        && suppressionMatch(
            captureNavigationChangeDetectionState(entry), checkpoint.suppressed,
        );
}

/** Read every configured navigation back off the live entity. */
function navigationValuesMatch(
    entry: EntityEntry<object>,
    checkpoint: OwnedEntryCheckpoint,
): boolean {
    const values = entry.entity as Record<string, unknown>;
    return [...checkpoint.navigations].every(([property, value]) =>
        !navigationValueChanged(value, values[property]));
}

/** Navigation baselines: the same properties, holding the same graph. */
function containersMatch(
    current: ReadonlyMap<string, unknown>,
    captured: ReadonlyMap<string, unknown>,
): boolean {
    return current.size === captured.size
        && [...captured].every(([property, value]) =>
            current.has(property) &&
            !navigationValueChanged(value, current.get(property)));
}

/** Loaded-navigation flags, including the reference key each was loaded for. */
function loadedMatch(
    current: ReadonlyMap<string, string | null>,
    captured: ReadonlyMap<string, string | null>,
): boolean {
    return current.size === captured.size
        && [...captured].every(([property, key]) =>
            current.has(property) && Object.is(current.get(property), key));
}

/** Change-detection suppression, property for property. */
function suppressionMatch(
    current: ReadonlySet<string>,
    captured: ReadonlySet<string>,
): boolean {
    return current.size === captured.size
        && [...captured].every(property => current.has(property));
}
