import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import { navigationSnapshot } from './navigation-snapshot';
import { temporaryGeneratedProperty } from './temporary-generated-identity';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';

/** Keep unresolved tracked identity from becoming a durable FK by detachment. */
export function assertTemporaryPrincipalCanDetach(
    tracker: ChangeTracker,
    principal: EntityEntry<object>,
): void {
    for (const dependent of tracker.entries()) {
        const relationships = dependent.metadata.relationships as
            readonly TrackedRelationshipMetadata[];
        for (const relationship of relationships) {
            if (
                relationship.principalEntity !== principal.metadata.ctor ||
                !relationshipUsesTemporaryKey(principal, relationship) ||
                !targetsPrincipal(dependent, principal, relationship)
            ) continue;
            throw new Error(
                `Cannot detach or cancel newly added '${
                    principal.metadata.entityName
                }' while tracked '${dependent.metadata.entityName}.` +
                `${relationship.navigationProperty}' still targets its ` +
                'unresolved store-generated identity. Remove or sever the ' +
                'relationship first.',
            );
        }
    }
}

function relationshipUsesTemporaryKey(
    principal: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
): boolean {
    return (relationship.principalKeyProperties ??
        principal.metadata.keyProperties).some(property =>
        temporaryGeneratedProperty(principal, property) !== undefined);
}

function targetsPrincipal(
    dependent: EntityEntry<object>,
    principal: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
): boolean {
    const current = (dependent.entity as Record<string, unknown>)[
        relationship.navigationProperty
    ];
    const baseline = navigationSnapshot(
        dependent, relationship.navigationProperty,
    );
    if (current === principal.entity || baseline.value === principal.entity) {
        return true;
    }
    const inverse = relationship.inverseNavigationProperty;
    if (!inverse) return false;
    const value = (principal.entity as Record<string, unknown>)[inverse];
    return value === dependent.entity ||
        Array.isArray(value) && value.includes(dependent.entity);
}
