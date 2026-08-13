import type { Model } from '../model/model';
import { RelationshipCardinality } from '../model/relationship-metadata';
import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import { EntityState } from './entity-state';
import type { RelationshipDetectionValues } from './relationship-detection-values';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';
import {
    captureOneToOneIntent,
    type OneToOneIntent,
} from './one-to-one-change-intent';

export function assertSupportedOneToOneChanges(
    tracker: ChangeTracker,
    model: Model,
    captured: RelationshipDetectionValues,
): void {
    for (const dependentMetadata of model.entities) {
        for (const relationship of dependentMetadata.relationships as
            readonly TrackedRelationshipMetadata[]) {
            if (relationship.cardinality !== RelationshipCardinality.OneToOne) {
                continue;
            }
            const intents = tracker.entries()
                .filter(entry =>
                    entry.metadata === dependentMetadata &&
                    entry.state !== EntityState.Deleted &&
                    entry.state !== EntityState.Detached)
                .map(entry => captureOneToOneIntent(
                    tracker, model, entry, relationship, captured,
                ));
            assertNoCompetingExplicitOwners(intents, relationship);
            assertNoOwnershipCycle(intents);
        }
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
