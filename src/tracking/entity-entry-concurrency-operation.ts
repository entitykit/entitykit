import { RestorationScope } from '../restoration-scope';
import type { EntityEntryStore } from './entity-entry-store';

/** Run one concurrency mutation against a complete pre-operation checkpoint. */
export function runFailureAtomicConcurrencyOperation(
    store: EntityEntryStore,
    action: (restoration: RestorationScope) => void,
): void {
    const checkpoint = store.captureRestoration();
    const restoration = new RestorationScope(
        store.markRestorationFailure.bind(store),
    );
    try {
        action(restoration);
        restoration.throwIfFailed();
    } catch (error) {
        restoration.capturePrimary(error);
        restoration.attempt(checkpoint.rollback.bind(checkpoint));
        restoration.rethrowPrimary();
    }
}
