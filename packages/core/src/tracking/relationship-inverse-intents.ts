import type { Model } from '../model/model';
import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import { captureNavigation } from './navigation-snapshot';
import type { RelationshipDetectionValues } from './relationship-detection-values';
import { linkDependent, severDependent } from './relationship-fixup';
import {
    collectInverseIntents,
    type ChangedInverse,
    type InverseIntent,
    type InverseIntents,
} from './relationship-inverse-intent-collection';
import { relationshipConnects } from './relationship-resolution';
import type { LoadedInverseCollectionBatch } from './loaded-inverse-collection-batch';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';

/** Resolve the complete inverse graph before applying any orphan semantics. */
export function resolveInverseIntents(
    tracker: ChangeTracker,
    model: Model,
    entries: ReadonlyArray<EntityEntry<object>>,
    captured: RelationshipDetectionValues,
    inverseCollections?: LoadedInverseCollectionBatch,
): void {
    const intents: InverseIntents = new Map();
    const changes: ChangedInverse[] = [];
    collectInverseIntents(tracker, model, entries, intents, changes);
    const all = [...intents.values()].flatMap(byRelationship => [...byRelationship.values()]);
    assertUnambiguousTargets(all);
    const reassigned: Map<TrackedRelationshipMetadata, Set<EntityEntry<object>>> = new Map();
    for (const intent of all) {
        if (intent.addedTo.size !== 1) continue;
        const dependents = reassigned.get(intent.relationship) ?? new Set<EntityEntry<object>>();
        dependents.add(intent.dependent); reassigned.set(intent.relationship, dependents);
    }
    for (const intent of all.filter(candidate => candidate.addedTo.size === 1)) {
        const target = [...intent.addedTo][0];
        linkDependent(
            tracker, model, intent.dependent, intent.relationship,
            target.entity, undefined, captured, reassigned.get(intent.relationship), inverseCollections,
        );
    }
    for (const intent of all.filter(candidate => candidate.addedTo.size === 0)) {
        const previous = [...intent.removedFrom].find(principal =>
            relationshipConnects(
                tracker, model, intent.dependent, intent.relationship,
                principal, captured,
            ));
        if (previous) {
            severDependent(
                tracker, intent.dependent, intent.relationship,
                previous.entity, captured, inverseCollections,
            );
        }
    }
    inverseCollections?.publish(() => undefined);
    for (const change of changes) {
        if (change.handled) captureNavigation(change.principal, change.property);
    }
}

function assertUnambiguousTargets(intents: readonly InverseIntent[]): void {
    const ambiguous = intents.find(intent => intent.addedTo.size > 1);
    if (!ambiguous) return;
    throw new Error(
        `Dependent '${ambiguous.dependent.metadata.entityName}' appears in ` +
        'more than one final inverse navigation for relationship ' +
        `'${ambiguous.relationship.navigationProperty}'.`,
    );
}
