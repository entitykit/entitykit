import { readPropertyPath } from '../model/property-value-access';
import { cloneBoundValues } from './bound-value-snapshot';
import {
    relationshipDetectionIdentityKey as registeredIdentityKey,
} from './change-tracker-relationship-detection-registry';
import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import type { EntityState } from './entity-state';
import {
    captureEntryLoadedNavigations,
} from './entity-entry-navigation-checkpoint';
import { cloneNavigationContainer } from './navigation-collection-copy';
import {
    captureNavigationChangeDetectionState,
} from './navigation-change-detection-state';
import {
    captureNavigationSnapshotValues,
    type NavigationSnapshotValues,
} from './navigation-snapshot';

/**
 * The complete fingerprint of one entry at the moment a load registered it.
 *
 * State is a *symptom* of interference, never proof of its absence: EntityKit
 * does not require `detectChanges()` after an edit, so a direct scalar write
 * leaves the entry Unchanged until the next detection pass, and an accepted
 * edit returns it to Unchanged outright. "Unchanged because untouched" and
 * "Unchanged because newer work was accepted" are indistinguishable by state
 * alone, and detaching the second silently discards the user's write.
 *
 * So the checkpoint records every fact outside work could disturb: the mapped
 * values and complex containers, the tracked baselines behind them, the
 * identity registration, the configured navigation values, and the tracker
 * facts (baselines, loaded flags, change-detection suppression) that a load
 * moves. Rollback detaches only when *all* of it still matches.
 *
 * `originalValues` is the entry's own baseline, taken by reference and never
 * copied, and it does double duty. Acceptance and refresh *replace* that object
 * rather than editing it, so a captured reference is a stable pre-image of the
 * baseline; and `own()` is called the instant `track()` returns for an entity
 * materialization has just built from the very row those values came from, with
 * every write verified converter-aware, so it is equally a pre-image of the
 * *live* mapped values. That is the same identity `detectChanges()` relies on
 * when it reports a freshly materialized entity Unchanged. Comparison reads it
 * through the property's own converter, so a value object whose state is
 * private (a `#value`, a non-enumerable own property) is compared by the
 * provider fact it converts to rather than by a structural walk that cannot
 * see it.
 *
 * Capture runs no converter and reads no mapped property: loads materialize
 * many entities, and a navigation load's contract is to reuse the provider facts
 * tracking already holds rather than re-deriving them. It is not free, though,
 * and the part that is not is the part that matters twice over. Capture reads
 * every configured navigation property and every complex container off the live
 * entity -- one property read each, no conversion, no walk. That read is the
 * per-entity cost of the capture, and it is also its failure boundary: it runs
 * application accessors, the only code here that can throw. Registration already
 * read each navigation once when it initialized the snapshots, so an accessor
 * that refuses every read fails inside `track()` and no entry exists to
 * fingerprint; one that is not read-stable fails here instead, after the entry
 * is tracked -- which is why the registration is recorded before this runs.
 * Everything else is a handful of small map copies over facts registration had
 * just computed. The converter work happens once per owned entry, on the failure
 * path only, when rollback compares.
 */
export interface OwnedEntryCheckpoint {
    readonly state: EntityState;
    readonly identityKey: string | undefined;
    /** Complex containers by reference; their leaves are mapped values. */
    readonly complex: ReadonlyMap<string, unknown>;
    /** The entry's own value baseline, which is also the live pre-image. */
    readonly originalValues: Readonly<Record<string, unknown>>;
    readonly originalBoundValues: Readonly<Record<string, unknown>>;
    /** Configured navigation values, containers copied, contents by identity. */
    readonly navigations: ReadonlyMap<string, unknown>;
    readonly baselines: NavigationSnapshotValues;
    readonly loaded: ReadonlyMap<string, string | null>;
    readonly suppressed: ReadonlySet<string>;
}

/** Fingerprint a freshly tracked entry, before this load changes anything. */
export function captureOwnedEntryCheckpoint(
    tracker: ChangeTracker,
    entry: EntityEntry<object>,
): OwnedEntryCheckpoint {
    // The baseline keys are the navigation set registration just initialized,
    // so they name exactly the configured navigations of this entity.
    const baselines = captureNavigationSnapshotValues(entry);
    return {
        state: entry.state,
        identityKey: registeredIdentityKey(tracker, entry),
        complex: capturedComplexValues(entry),
        originalValues: entry.originalValues,
        originalBoundValues: cloneBoundValues(entry.originalBoundValues),
        navigations: capturedNavigationValues(entry, baselines.keys()),
        baselines,
        loaded: captureEntryLoadedNavigations(entry),
        suppressed: captureNavigationChangeDetectionState(entry),
    };
}

/** Complex containers, kept by reference so a replacement is visible. */
function capturedComplexValues(
    entry: EntityEntry<object>,
): ReadonlyMap<string, unknown> {
    return new Map(entry.metadata.complexProperties.map(complex => [
        complex.propertyName,
        readPropertyPath(entry.entity, complex.propertyPath),
    ]));
}

/** Navigation values copied the way a journaled write captures them. */
function capturedNavigationValues(
    entry: EntityEntry<object>,
    properties: Iterable<string>,
): ReadonlyMap<string, unknown> {
    const values = entry.entity as Record<string, unknown>;
    return new Map([...properties].map(property => [
        property,
        cloneNavigationContainer(values[property]),
    ]));
}
