import { RestorationScope } from '../restoration-scope';
import type { ChangeTracker } from './change-tracker';
import { captureNavigationLoadCheckpoint } from './navigation-load-checkpoint';
import { NavigationWriteJournal } from './navigation-write-journal';

/**
 * The failure-atomic boundary around one navigation load.
 *
 * Explicit reference/collection loads, eager `include(...)` stitching, and lazy
 * loading all publish graph writes, loaded flags, navigation baselines, and
 * newly tracked related entities. When any of that fails part-way, the caller
 * must not be left with half a relationship: the journal restores every graph
 * write in reverse, the checkpoint restores the tracker facts and detaches the
 * entities this load was the first to track, the original failure is preserved,
 * and a restoration that cannot complete poisons the context.
 */
export async function runNavigationLoadOperation<TResult>(
    tracker: ChangeTracker,
    markRestorationFailure: (error: unknown) => void,
    load: (journal: NavigationWriteJournal) => Promise<TResult>,
): Promise<TResult> {
    const checkpoint = captureNavigationLoadCheckpoint(tracker);
    const journal = new NavigationWriteJournal();
    try {
        return await load(journal);
    } catch (error) {
        const scope = new RestorationScope(markRestorationFailure);
        scope.capturePrimary(error);
        journal.rollback(scope);
        scope.attemptAll(checkpoint.restorationActions());
        return scope.rethrowPrimary();
    }
}
