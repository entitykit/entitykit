import type { NavigationLoadTrackerJournal } from './navigation-load-tracker-journal';
import type { NavigationWriteJournal } from './navigation-write-journal';

/**
 * What one navigation load operation hands to its collaborators.
 *
 * `journal` unwinds the graph writes. `trackerJournal` unwinds the tracker
 * facts: the entities this load was the first to track, which rollback
 * detaches, and the individual navigations whose loaded flags, baselines, and
 * change-detection suppression the load changed, which rollback restores in
 * place. Both are recorded at the moment they happen, never inferred by
 * comparing tracker membership before and after, so an `add()`, an `attach()`,
 * or a queued `link()` that lands while the load is in flight is neither
 * detached as though the load had tracked it nor left describing the failed
 * load's temporary graph once that graph is rolled back.
 */
export interface NavigationLoadScope {
    readonly journal: NavigationWriteJournal;
    readonly trackerJournal: NavigationLoadTrackerJournal;
}
