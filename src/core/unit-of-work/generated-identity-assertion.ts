import type { SavePlanEntry } from '../save-plan';
import type { ChangeTracker } from '../../tracking/change-tracker';

/** Reject a generated key that is already represented in the identity map. */
export function assertGeneratedIdentityAvailable(
    changeTracker: ChangeTracker,
    entry: SavePlanEntry,
): void {
    const tracked = changeTracker.entry(entry.entity);
    if (!tracked) {
        return;
    }
    const existing = changeTracker.tryGetByIdentityValues(
        tracked.metadata,
        tracked.metadata.getKeyValues(entry.entity),
    );
    if (existing && existing !== tracked) {
        throw new Error(
            `An instance of '${tracked.metadata.entityName}' with key '${String(tracked.keyValue)}' is already tracked.`,
        );
    }
}
