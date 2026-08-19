import type { RelationshipMetadata } from '../../model/relationship-metadata';
import type { Model } from '../../model/model';
import type { EntityConstructor } from '../../types';
import type { PersistedEntrySnapshot } from '../../tracking/persisted-entry-snapshot';
import {
    relationshipTargetCandidate,
    selectRelationshipTarget,
} from '../../tracking/relationship-target-candidate';
import {
    relationshipTargetIsMissing,
    scopedDependentRelationshipTarget,
    scopedPrincipalRelationshipTarget,
} from '../../tracking/relationship-target-scope';
import type { ChangeTracker } from '../../tracking/change-tracker';
import type { TrackedRelationshipMetadata } from '../../tracking/tracked-relationship-metadata';

export function findPrincipalEntry(
    relationship: RelationshipMetadata,
    dependent: PersistedEntrySnapshot,
    facts: 'current' | 'original',
    tracker: ChangeTracker,
    model: Model,
    entriesByType: ReadonlyMap<
        EntityConstructor<object>,
        readonly PersistedEntrySnapshot[]
    >,
    entriesByEntity: ReadonlyMap<object, PersistedEntrySnapshot>,
): PersistedEntrySnapshot | undefined {
    const trackedRelationship = relationship as TrackedRelationshipMetadata;
    const navigation = facts === 'current'
        ? dependent.relationshipValues[String(relationship.navigationProperty)]
        : dependent.navigations.get(String(relationship.navigationProperty));
    const principalByNavigation = entriesByEntity.get(
        navigation as object,
    );
    if (principalByNavigation) {
        return principalByNavigation;
    }
    const bound = facts === 'current'
        ? dependent.boundValues
        : dependent.originalBoundValues;
    if (relationshipTargetIsMissing(trackedRelationship, bound)) return undefined;
    const target = scopedDependentRelationshipTarget(
        tracker, model, dependent.entry, trackedRelationship, bound,
    );
    const matches = (entriesByType.get(relationship.principalEntity) ?? [])
        .filter(snapshot => scopedPrincipalRelationshipTarget(
            tracker,
            dependent.entry,
            trackedRelationship,
            snapshot.entry,
            facts === 'current'
                ? snapshot.boundValues
                : snapshot.originalBoundValues,
        ) === target);
    const resolved = selectRelationshipTarget(
        dependent.entry,
        trackedRelationship,
        bound,
        matches.map(snapshot => relationshipTargetCandidate(
            trackedRelationship, snapshot.entry,
        )),
    );
    if (resolved.kind !== 'stable' && resolved.kind !== 'temporary') {
        return undefined;
    }
    return matches.find(snapshot => snapshot.entry === resolved.principal);
}
