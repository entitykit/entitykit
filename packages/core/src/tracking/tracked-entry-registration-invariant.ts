import type { EntityEntry } from './entity-entry';
import type { TrackedIdentityMap } from './tracked-identity-map';
import { assertTrackingIdentityRegistration } from './temporary-generated-identity';

/** Validate the registry facts touched while one entity is tracked. */
export function assertTrackedEntryRegistration(
    entity: object,
    entry: EntityEntry<object>,
    entriesByEntity: WeakMap<object, EntityEntry<object>>,
    identities: TrackedIdentityMap,
    trackedEntries: ReadonlySet<EntityEntry<object>>,
): void {
    const identityKey = identities.keyFor(entry);
    if (
        entriesByEntity.get(entity) !== entry ||
        !trackedEntries.has(entry) ||
        identityKey === undefined ||
        identities.get(identityKey) !== entry
    ) {
        throw new Error(
            `Identity-map invariant failed for tracked '${entry.metadata.entityName}'.`,
        );
    }
    assertTrackingIdentityRegistration(entry, identityKey);
}
