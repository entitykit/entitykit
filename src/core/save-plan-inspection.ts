import { RestorationScope } from '../restoration-scope';
import type { SaveTimeWrites } from './save-time-writes';

/** Inspect a temporary save plan and always unwind its live policy writes. */
export function inspectSavePlan<TResult>(
    markFailure: (error: unknown) => void,
    writes: SaveTimeWrites,
    inspect: (restoration: RestorationScope) => TResult,
): TResult {
    const restoration = new RestorationScope(markFailure);
    try {
        const result = inspect(restoration);
        restoration.attempt(writes.restore.bind(writes));
        restoration.throwIfFailed();
        return result;
    } catch (error) {
        restoration.capturePrimary(error);
        restoration.attempt(writes.restore.bind(writes));
        return restoration.rethrowPrimary();
    }
}
