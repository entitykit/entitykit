import { RestorationScope } from '../restoration-scope';
import type { ChangeTracker } from './change-tracker';
import type { NavigationLoadScope } from './navigation-load-scope';
import { createNavigationLoadTrackerJournal } from './navigation-load-tracker-journal';
import { NavigationWriteJournal } from './navigation-write-journal';

/**
 * The failure-atomic boundary around one navigation load.
 *
 * Explicit reference/collection loads, eager `include(...)` stitching, and lazy
 * loading all publish graph writes, loaded flags, navigation baselines, and
 * newly tracked related entities. When any of that fails part-way, the caller
 * must not be left with half a relationship: the journal restores every graph
 * write in reverse, the tracker journal restores the facts of every navigation
 * the load participated in and detaches only the entities the load tracked,
 * the original failure is preserved, and a restoration that cannot complete
 * poisons the context. The load's own result is produced inside the boundary,
 * so reading it is covered by the rollback too.
 */
export async function runNavigationLoadOperation<TResult>(
    tracker: ChangeTracker,
    markRestorationFailure: (error: unknown) => void,
    load: (scope: NavigationLoadScope) => Promise<TResult>,
): Promise<TResult> {
    const trackerJournal = createNavigationLoadTrackerJournal(tracker);
    const journal = new NavigationWriteJournal();
    try {
        return await load({ journal, trackerJournal });
    } catch (error) {
        const scope = new RestorationScope(markRestorationFailure);
        scope.capturePrimary(error);
        journal.rollback(scope);
        scope.attemptAll(trackerJournal.restorationActions());
        return scope.rethrowPrimary();
    }
}
