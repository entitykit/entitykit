import type { NavigationWriteJournal } from './navigation-write-journal';

/**
 * What one navigation load operation hands to its collaborators.
 *
 * The journal unwinds graph writes. `recordTrackedByLoad` is how the include
 * materializer states, at the moment it happens, that *this* load was the first
 * to track an entity: it is called only on the fresh-track branch, never for an
 * identity-map hit. Rollback detaches exactly those recorded entities, so
 * tracking that arrived from anywhere else while the load was in flight -- an
 * `add()`, an `attach()`, a queued `link()` -- survives a failed load. Temporal
 * ordering is not ownership, so the set is never inferred by comparing tracker
 * membership before and after.
 */
export interface NavigationLoadScope {
    readonly journal: NavigationWriteJournal;
    /** Record an entity this load freshly tracked, for rollback detachment. */
    recordTrackedByLoad(entity: object): void;
}
