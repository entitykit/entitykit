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

/** Resolve the complete inverse graph before applying any orphan semantics. */
export function resolveInverseIntents(
    tracker: ChangeTracker,
    model: Model,
    entries: ReadonlyArray<EntityEntry<object>>,
    captured: RelationshipDetectionValues,
): void {
    const intents: InverseIntents = new Map();
    const changes: ChangedInverse[] = [];
    collectInverseIntents(tracker, model, entries, intents, changes);
    const all = [...intents.values()].flatMap(byRelationship =>
        [...byRelationship.values()]);
    assertUnambiguousTargets(all);
    for (const intent of all.filter(candidate => candidate.addedTo.size === 1)) {
        const target = [...intent.addedTo][0];
        const reassigned = new Set(all.filter(candidate =>
            candidate.relationship === intent.relationship &&
            candidate.addedTo.size === 1).map(candidate =>
            candidate.dependent));
        linkDependent(
            tracker, model, intent.dependent, intent.relationship,
            target.entity, undefined, captured, reassigned,
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
                previous.entity, captured,
            );
        }
    }
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
