import type { RestorationScope } from './restoration-scope';
import { NavigationWriteJournal } from './tracking/navigation-write-journal';

interface FailureAtomicNavigationWrite {
    readonly entity: object;
    readonly navigationProperty: string;
    readonly value: unknown;
    readonly entityName: string;
    readonly scope: RestorationScope;
}

/**
 * Write one navigation with immediate verified restoration on failure.
 *
 * The navigation sibling of `writeFailureAtomicProperty`, for an operation whose
 * only graph write is this one. An operation that publishes several navigations
 * before one can fail needs {@link NavigationWriteJournal} directly, so the
 * earlier writes unwind too.
 */
export function writeFailureAtomicNavigation(
    options: FailureAtomicNavigationWrite,
): unknown {
    const journal = new NavigationWriteJournal();
    try {
        return journal.write(
            options.entity,
            options.navigationProperty,
            options.value,
            options.entityName,
        );
    } catch (error) {
        options.scope.capturePrimary(error);
        journal.rollback(options.scope);
        throw error;
    }
}
