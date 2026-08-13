import { DeleteBehavior } from '../model/relationship-metadata';
import type { EntityEntry } from './entity-entry';
import { EntityState } from './entity-state';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';
import {
    type OneToOneIntent,
    type OneToOneIntentGroup,
} from './one-to-one-change-intent';

export function assertSupportedOneToOneChanges(
    groups: readonly OneToOneIntentGroup[],
): void {
    for (const { relationship, intents } of groups) {
        assertNoCompetingExplicitOwners(intents, relationship);
        assertNoOwnershipCycle(intents);
        assertNoSoftDeleteDisplacement(intents, relationship);
    }
}

function assertNoSoftDeleteDisplacement(
    intents: readonly OneToOneIntent[],
    relationship: TrackedRelationshipMetadata,
): void {
    const previousOwner: Map<
        EntityEntry<object>, OneToOneIntent
    > = new Map();
    for (const intent of intents) {
        if (intent.previous) previousOwner.set(intent.previous, intent);
    }
    const unsupported = intents.find(intent => {
        if (!intent.changed || !intent.desired) return false;
        const occupant = previousOwner.get(intent.desired);
        return occupant !== undefined &&
            occupant.dependent !== intent.dependent &&
            occupant.dependent.metadata.softDelete !== undefined &&
            (occupant.dependent.state === EntityState.Deleted ||
                relationship.deleteBehavior === DeleteBehavior.Cascade &&
                relationship.foreignKeyProperties.every(property =>
                    occupant.dependent.metadata.getProperty(property)
                        .isRequired) &&
                (!occupant.changed || occupant.desired === undefined ||
                    occupant.desired === intent.desired));
    });
    if (unsupported) {
        throw new Error(
            'One-to-one replacement cannot displace a soft-deletable ' +
            'dependent because its unique relationship slot is retained. ' +
            'Delete or reassign the existing dependent explicitly first.',
        );
    }
}

function assertNoCompetingExplicitOwners(
    intents: readonly OneToOneIntent[],
    relationship: TrackedRelationshipMetadata,
): void {
    const changedByTarget: Map<
        EntityEntry<object>, OneToOneIntent
    > = new Map();
    for (const intent of intents) {
        if (!intent.changed || !intent.desired) continue;
        const existing = changedByTarget.get(intent.desired);
        if (existing && existing.dependent !== intent.dependent) {
            throw new Error(
                `One-to-one relationship '${relationship.navigationProperty}' has more than one explicit dependent for the same principal.`,
            );
        }
        changedByTarget.set(intent.desired, intent);
    }
}

function assertNoOwnershipCycle(
    intents: readonly OneToOneIntent[],
): void {
    const previousOwner: Map<
        EntityEntry<object>, OneToOneIntent
    > = new Map();
    for (const intent of intents) {
        if (intent.previous) previousOwner.set(intent.previous, intent);
    }
    for (const start of intents.filter(intent =>
        intent.changed && intent.desired && intent.previous !== intent.desired)) {
        const visited: Set<OneToOneIntent> = new Set([start]);
        const desired = start.desired;
        if (!desired) continue;
        let current = previousOwner.get(desired);
        while (current?.changed && current.desired) {
            if (current === start) {
                throw new Error(
                    'EntityKit cannot atomically swap one-to-one ' +
                    'relationships under an immediate unique constraint. ' +
                    'Save an intermediate state first.',
                );
            }
            if (visited.has(current)) break;
            visited.add(current);
            current = previousOwner.get(current.desired);
        }
    }
}
