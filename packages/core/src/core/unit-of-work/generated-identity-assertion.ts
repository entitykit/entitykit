import type { SavePlanEntry } from '../save-plan';
import type { ChangeTracker } from '../../tracking/change-tracker';

/** Reject a generated key that is already represented in the identity map. */
export function assertGeneratedIdentityAvailable(
    changeTracker: ChangeTracker,
    entry: SavePlanEntry,
    persistedKeyValues: readonly unknown[],
    persistedBoundValues: Readonly<Record<string, unknown>>,
): void {
    const tracked = changeTracker.entry(entry.entity);
    if (!tracked) {
        return;
    }
    const existing = changeTracker.tryGetByBoundIdentityValues(
        tracked.metadata,
        persistedBoundValues,
    );
    if (existing && existing !== tracked) {
        const persistedKey = persistedKeyValues.length === 1
            ? persistedKeyValues[0]
            : persistedKeyValues;
        throw new Error(
            `An instance of '${tracked.metadata.entityName}' with key '${String(persistedKey)}' is already tracked.`,
        );
    }
}
