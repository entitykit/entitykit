import { cloneNavigationContainer } from './navigation-collection-copy';
import { navigationValueChanged } from './navigation-snapshot';

/**
 * Reassign one navigation to a captured value and verify the accessor kept it.
 *
 * Restoration is checked with the same identity semantics a forward write uses,
 * so a setter that silently substitutes, reorders, or clones the container is a
 * restoration *failure* rather than a silent split graph.
 *
 * A restoration whose *assignment* throws is forgiven when the navigation
 * already holds the captured value: a forward write that failed before mutating
 * anything -- a getter-only navigation rejecting it outright, say -- leaves
 * nothing to undo, and the accessor that refused the write would otherwise
 * refuse the identical rollback and poison a context that was never damaged.
 * The check reads the live value defensively and only ever *forgives* a throw;
 * an unreadable navigation, or one holding anything else, still fails closed.
 */
export function restoreNavigationValue(
    entity: object,
    navigationProperty: string,
    value: unknown,
    entityName: string,
): void {
    const previous = cloneNavigationContainer(value);
    const values = entity as Record<string, unknown>;
    try {
        values[navigationProperty] = previous;
    } catch (error) {
        if (navigationAlreadyHolds(values, navigationProperty, previous)) {
            return;
        }
        throw error;
    }
    if (navigationValueChanged(previous, values[navigationProperty])) {
        throw new Error(
            `Navigation '${entityName}.${navigationProperty}' refused its restoration value.`,
        );
    }
}

/** Report whether the live navigation already equals the captured value. */
function navigationAlreadyHolds(
    values: Record<string, unknown>,
    navigationProperty: string,
    previous: unknown,
): boolean {
    try {
        return !navigationValueChanged(previous, values[navigationProperty]);
    } catch {
        return false;
    }
}
