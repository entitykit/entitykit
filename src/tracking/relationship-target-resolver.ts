import type { Model } from '../model/model';
import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import type { RelationshipDetectionValues } from './relationship-detection-values';
import { relationshipBoundValuesFor } from './relationship-detection-values';
import {
    assertTrackedTargetCanBeAssigned,
    relationshipTargetCandidate,
    type RelationshipTargetCandidate,
    type RelationshipTargetResolution,
    selectRelationshipTarget,
} from './relationship-target-candidate';
import {
    relationshipTargetIsMissing,
    scopedDependentRelationshipTarget,
    scopedPrincipalRelationshipTarget,
} from './relationship-target-scope';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';
import {
    rememberGeneratedRelationshipTarget,
    rolledBackGeneratedRelationshipTarget,
} from './generated-relationship-target-provenance';

export { assertTrackedTargetCanBeAssigned };
export type { RelationshipTargetResolution };

type CandidateIndex = ReadonlyMap<
    string,
    readonly RelationshipTargetCandidate[]
>;

const indexes: WeakMap<RelationshipDetectionValues,
    WeakMap<TrackedRelationshipMetadata, CandidateIndex>> = new WeakMap();

/** Resolve one captured FK without relying on tracker insertion order. */
export function resolveRelationshipTarget(
    tracker: ChangeTracker,
    model: Model,
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    captured: RelationshipDetectionValues,
): RelationshipTargetResolution {
    const bound = relationshipBoundValuesFor(dependent, captured);
    if (relationshipTargetIsMissing(relationship, bound)) return { kind: 'none' };
    const rolledBack = rolledBackGeneratedRelationshipTarget(
        tracker, dependent, relationship, bound,
    );
    if (rolledBack) {
        return relationshipTargetCandidate(relationship, rolledBack);
    }
    const target = scopedDependentRelationshipTarget(
        tracker, model, dependent, relationship, bound,
    );
    const matches = targetIndex(
        tracker, model, dependent, relationship, captured,
    )
        .get(target) ?? [];
    const resolved = selectRelationshipTarget(
        dependent, relationship, bound, matches,
    );
    if (resolved.kind === 'stable') {
        rememberGeneratedRelationshipTarget(
            dependent, relationship, resolved.principal, bound,
        );
    }
    return resolved;
}

/** Resolve reloaded provider facts against captured tracked principal facts. */
export function resolveRelationshipTargetByBoundValues(
    tracker: ChangeTracker,
    model: Model,
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    bound: Readonly<Record<string, unknown>>,
): RelationshipTargetResolution {
    if (relationshipTargetIsMissing(relationship, bound)) return { kind: 'none' };
    const principalMetadata = model.getEntity<Record<string, unknown>>(
        relationship.principalEntity,
    );
    const target = scopedDependentRelationshipTarget(
        tracker, model, dependent, relationship, bound,
    );
    const matches = tracker.entries().flatMap(entry => {
        if (entry.metadata !== principalMetadata) return [];
        const principalTarget = scopedPrincipalRelationshipTarget(
            tracker, dependent, relationship, entry, entry.originalBoundValues,
        );
        return principalTarget === target
            ? [relationshipTargetCandidate(relationship, entry)]
            : [];
    });
    return selectRelationshipTarget(dependent, relationship, bound, matches);
}

function targetIndex(
    tracker: ChangeTracker,
    model: Model,
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    captured: RelationshipDetectionValues,
): CandidateIndex {
    let byRelationship = indexes.get(captured);
    if (!byRelationship) {
        const created: WeakMap<
            TrackedRelationshipMetadata,
            CandidateIndex
        > = new WeakMap();
        byRelationship = created;
        indexes.set(captured, byRelationship);
    }
    const existing = byRelationship.get(relationship);
    if (existing) return existing;
    const principalMetadata = model.getEntity<Record<string, unknown>>(
        relationship.principalEntity,
    );
    const built: Map<string, RelationshipTargetCandidate[]> = new Map();
    for (const entry of tracker.entries()) {
        if (entry.metadata !== principalMetadata) continue;
        const bound = relationshipBoundValuesFor(entry, captured);
        const target = scopedPrincipalRelationshipTarget(
            tracker, dependent, relationship, entry, bound,
        );
        const matches = built.get(target) ?? [];
        matches.push(relationshipTargetCandidate(relationship, entry));
        built.set(target, matches);
    }
    byRelationship.set(relationship, built);
    return built;
}
