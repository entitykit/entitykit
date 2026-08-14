import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import { cloneSnapshotValue } from './snapshot-value-clone';
import { snapshotValuesEqual } from './snapshot-value-equality';
import {
    activeTemporaryGeneratedIdentity,
    temporaryGeneratedIdentity,
} from './temporary-generated-identity';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';

interface GeneratedRelationshipTargetProvenance {
    readonly principal: EntityEntry<object>;
    readonly generatedProviderValues: readonly unknown[];
    readonly temporaryProviderValues: readonly unknown[];
}

const targets: WeakMap<
    EntityEntry<object>,
    Map<TrackedRelationshipMetadata, GeneratedRelationshipTargetProvenance>
> = new WeakMap();

/** Remember the exact principal behind a resolved generated FK tuple. */
export function rememberGeneratedRelationshipTarget(
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    principal: EntityEntry<object>,
    dependentBoundValues: Readonly<Record<string, unknown>>,
): void {
    const principalProperties = principalKeyProperties(
        relationship, principal,
    );
    const temporary = temporaryGeneratedIdentity(principal);
    if (!temporary || !principalProperties.some(property =>
        temporary.properties.some(candidate =>
            candidate.propertyName === property))) return;

    const byRelationship = targets.get(dependent) ?? new Map<
        TrackedRelationshipMetadata,
        GeneratedRelationshipTargetProvenance
    >();
    byRelationship.set(relationship, {
        principal,
        generatedProviderValues: relationship.foreignKeyProperties.map(
            property => cloneSnapshotValue(dependentBoundValues[property]),
        ),
        temporaryProviderValues: principalProperties.map(property =>
            cloneSnapshotValue(temporary.properties.find(candidate =>
                candidate.propertyName === property)?.providerValue ??
            principal.originalBoundValues[property])),
    });
    targets.set(dependent, byRelationship);
}

/** Resolve a rolled-back generated FK tuple to its exact tracked principal. */
export function rolledBackGeneratedRelationshipTarget(
    tracker: ChangeTracker,
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    dependentBoundValues: Readonly<Record<string, unknown>>,
): EntityEntry<object> | undefined {
    const byRelationship = targets.get(dependent);
    if (!byRelationship) return undefined;
    const remembered = byRelationship.get(relationship);
    if (!remembered) return undefined;

    const { principal } = remembered;
    const navigation = (dependent.entity as Record<string, unknown>)[
        relationship.navigationProperty
    ];
    if (
        navigation !== null && navigation !== undefined &&
        navigation !== principal.entity
    ) return undefined;
    const matchesRemembered = sameForeignKey(
        relationship, dependentBoundValues,
        remembered.generatedProviderValues,
    ) || sameForeignKey(
        relationship, dependentBoundValues,
        remembered.temporaryProviderValues,
    );
    if (tracker.entry(principal.entity) !== principal) {
        byRelationship.delete(relationship);
        if (matchesRemembered) {
            throw staleGeneratedRelationshipTarget(dependent, relationship);
        }
        return undefined;
    }

    const principalProperties = principalKeyProperties(
        relationship, principal,
    );
    const temporary = activeTemporaryGeneratedIdentity(
        principal, principalProperties,
    );
    if (!temporary) return undefined;
    return matchesRemembered ? principal : undefined;
}

function principalKeyProperties(
    relationship: TrackedRelationshipMetadata,
    principal: EntityEntry<object>,
): string[] {
    return (relationship.principalKeyProperties ??
        principal.metadata.keyProperties).map(String);
}

function sameForeignKey(
    relationship: TrackedRelationshipMetadata,
    current: Readonly<Record<string, unknown>>,
    generated: readonly unknown[],
): boolean {
    return relationship.foreignKeyProperties.every((property, index) =>
        snapshotValuesEqual(current[property], generated[index]));
}

function staleGeneratedRelationshipTarget(
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
): Error {
    return new Error(
        `Relationship '${dependent.metadata.entityName}.` +
        `${relationship.navigationProperty}' retains a rolled-back ` +
        'store-generated FK for a principal that is no longer tracked. ' +
        'Assign another principal navigation or foreign key before saving.',
    );
}
