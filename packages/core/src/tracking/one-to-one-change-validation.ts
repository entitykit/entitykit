import { DeleteBehavior } from '../model/relationship-metadata';
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
        assertNoSoftDeleteDisplacement(intents, relationship);
        assertNoCompetingExplicitOwners(intents, relationship);
        assertNoOwnershipCycle(intents);
        assertNoUntrackedOccupiedTarget(intents);
    }
}

function assertNoSoftDeleteDisplacement(
    intents: readonly OneToOneIntent[],
    relationship: TrackedRelationshipMetadata,
): void {
    const previousOwner: Map<string, OneToOneIntent> = new Map();
    for (const intent of intents) {
        if (intent.previousTarget) {
            previousOwner.set(intent.previousTarget, intent);
        }
    }
    const unsupported = intents.find(intent => {
        if (!intent.explicit || !intent.desiredTarget) return false;
        const occupant = previousOwner.get(intent.desiredTarget);
        return occupant !== undefined &&
            occupant.dependent !== intent.dependent &&
            occupant.dependent.metadata.softDelete !== undefined &&
            (occupant.dependent.state === EntityState.Deleted ||
                relationship.deleteBehavior === DeleteBehavior.Cascade &&
                relationship.foreignKeyProperties.every(property =>
                    occupant.dependent.metadata.getProperty(property)
                        .isRequired) &&
                (!occupant.changed || occupant.desiredTarget === undefined ||
                    occupant.desiredTarget === intent.desiredTarget));
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
    const claimsByTarget: Map<string, OneToOneIntent[]> = new Map();
    for (const intent of intents) {
        if (!intent.desiredTarget) continue;
        const claims = claimsByTarget.get(intent.desiredTarget) ?? [];
        claims.push(intent);
        claimsByTarget.set(intent.desiredTarget, claims);
    }
    for (const claims of claimsByTarget.values()) {
        const explicit = claims.filter(intent => intent.explicit);
        if (explicit.length > 1) {
            throw new Error(
                `One-to-one relationship '${relationship.navigationProperty}' has more than one explicit dependent for the same principal.`,
            );
        }
        if (explicit.length === 0 && claims.length > 1 || claims.length > 2) {
            throw new Error(
                `One-to-one relationship '${relationship.navigationProperty}' has more than one dependent for the same principal.`,
            );
        }
    }
}

function assertNoOwnershipCycle(
    intents: readonly OneToOneIntent[],
): void {
    const previousOwner: Map<string, OneToOneIntent> = new Map();
    for (const intent of intents) {
        if (intent.previousTarget) {
            previousOwner.set(intent.previousTarget, intent);
        }
    }
    for (const start of intents.filter(intent =>
        intent.changed && intent.desiredTarget &&
        intent.previousTarget !== intent.desiredTarget)) {
        const visited: Set<OneToOneIntent> = new Set([start]);
        const desired = start.desiredTarget;
        if (!desired) continue;
        let current = previousOwner.get(desired);
        while (current?.changed && current.desiredTarget) {
            if (current === start) {
                throw new Error(
                    'EntityKit cannot atomically swap one-to-one ' +
                    'relationships under an immediate unique constraint. ' +
                    'Save an intermediate state first.',
                );
            }
            if (visited.has(current)) break;
            visited.add(current);
            current = previousOwner.get(current.desiredTarget);
        }
    }
}

function assertNoUntrackedOccupiedTarget(
    intents: readonly OneToOneIntent[],
): void {
    const previousOwner: Map<string, OneToOneIntent> = new Map();
    for (const intent of intents) {
        if (intent.previousTarget) {
            previousOwner.set(intent.previousTarget, intent);
        }
    }
    const unsupported = intents.find(intent => {
        if (!intent.explicit || !intent.desiredTarget || intent.desired) {
            return false;
        }
        const occupant = previousOwner.get(intent.desiredTarget);
        return occupant !== undefined && occupant !== intent &&
            !occupant.explicit &&
            occupant.desiredTarget === intent.desiredTarget;
    });
    if (unsupported) {
        throw new Error(
            'One-to-one FK reassignment targets an occupied principal that ' +
            'is not tracked. Track the principal or save an intermediate ' +
            'state first.',
        );
    }
}
