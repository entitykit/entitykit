import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import type { RelationshipDetectionValues } from './relationship-detection-values';
import {
    temporaryGeneratedIdentity,
    temporaryGeneratedProperty,
} from './temporary-generated-identity';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';

type TemporaryTargets = ReadonlyMap<string, readonly string[]>;

const targetsByDetection: WeakMap<
    RelationshipDetectionValues,
    WeakMap<TrackedRelationshipMetadata, TemporaryTargets>
> = new WeakMap();

/** Resolve a placeholder FK to one tracked temporary principal identity. */
export function resolveTemporaryPrincipalTarget(
    tracker: ChangeTracker,
    relationship: TrackedRelationshipMetadata,
    captured: RelationshipDetectionValues,
    providerTarget: string,
    targetForEntry: (entry: EntityEntry<object>) => string,
): string {
    const targets = temporaryTargets(
        tracker, relationship, captured, targetForEntry,
    ).get(providerTarget) ?? [];
    if (targets.length > 1) {
        throw new Error(
            `One-to-one relationship '${relationship.navigationProperty}' ` +
            'has an ambiguous FK-only target because more than one tracked ' +
            'principal has the same unresolved generated key. Set the ' +
            'principal navigation explicitly.',
        );
    }
    return targets[0] ?? providerTarget;
}

function temporaryTargets(
    tracker: ChangeTracker,
    relationship: TrackedRelationshipMetadata,
    captured: RelationshipDetectionValues,
    targetForEntry: (entry: EntityEntry<object>) => string,
): TemporaryTargets {
    let byRelationship = targetsByDetection.get(captured);
    if (!byRelationship) {
        byRelationship = new WeakMap();
        targetsByDetection.set(captured, byRelationship);
    }
    const cached = byRelationship.get(relationship);
    if (cached) return cached;
    const targets: Map<string, string[]> = new Map();
    for (const entry of tracker.entries()) {
        if (entry.metadata.ctor !== relationship.principalEntity) continue;
        const properties = relationship.principalKeyProperties ??
            entry.metadata.keyProperties;
        if (!properties.some(property =>
            temporaryGeneratedProperty(entry, property) !== undefined)) {
            continue;
        }
        const temporary = temporaryGeneratedIdentity(entry);
        if (!temporary) continue;
        const provider = targetForEntry(entry);
        const matches = targets.get(provider) ?? [];
        matches.push(`temporary:${temporary.identityKey}`);
        targets.set(provider, matches);
    }
    byRelationship.set(relationship, targets);
    return targets;
}
