import { RestorationScope } from '../restoration-scope';

/** Run a tracker mutation in an owned or outer restoration scope. */
export function runRestorableTrackerOperation(
    markFailure: (error: unknown) => void,
    action: (restoration: RestorationScope) => void,
    restoration?: RestorationScope,
): void {
    const scope = restoration ?? new RestorationScope(markFailure);
    try {
        action(scope);
        if (!restoration) scope.throwIfFailed();
    } catch (error) {
        scope.capturePrimary(error);
        if (!restoration) scope.rethrowPrimary();
        throw error;
    }
}
