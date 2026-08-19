import type { EntityEntry } from './entity-entry';
import { EntityState } from './entity-state';

/** Resolve a tracking request without mutating an already tracked lifecycle. */
export function reuseTrackedEntry(
    entry: EntityEntry<object>,
    requestedState: EntityState,
): void {
    if (entry.state === requestedState) return;
    if (
        requestedState === EntityState.Unchanged &&
        entry.state !== EntityState.Added
    ) {
        return;
    }

    throw new Error(
        `Cannot track '${entry.metadata.entityName}' as ${requestedState} because ` +
        `the same instance is already tracked as ${entry.state}.`,
    );
}
