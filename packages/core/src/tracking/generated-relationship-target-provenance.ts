import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import { cloneSnapshotValue } from './snapshot-value-clone';
import { snapshotValuesEqual } from './snapshot-value-equality';
import {
    activeTemporaryGeneratedIdentity,
    temporaryGeneratedIdentity,
} from './temporary-generated-identity';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';
import {
    deleteGeneratedRelationshipTarget,
    generatedRelationshipTarget,
    storeGeneratedRelationshipTarget,
} from './generated-relationship-target-store';
import {
    ambiguousRestoredGeneratedRelationshipTarget,
    staleGeneratedRelationshipTarget,
} from './generated-relationship-target-error';

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

    storeGeneratedRelationshipTarget(dependent, relationship, {
        kind: 'active',
        principal,
        currentExpectedProviderValues: relationship.foreignKeyProperties.map(
            property => cloneSnapshotValue(dependentBoundValues[property]),
        ),
        currentValueIsFrameworkOwned: false,
    });
}

/** Resolve a rolled-back generated FK tuple to its exact tracked principal. */
export function rolledBackGeneratedRelationshipTarget(
    tracker: ChangeTracker,
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    dependentBoundValues: Readonly<Record<string, unknown>>,
): EntityEntry<object> | undefined {
    const remembered = generatedRelationshipTarget(dependent, relationship);
    if (!remembered) return undefined;
    const navigation = (dependent.entity as Record<string, unknown>)[
        relationship.navigationProperty
    ];
    if (navigation !== null && navigation !== undefined &&
        navigation !== (remembered.kind === 'active'
            ? remembered.principal.entity
            : remembered.sourceEntity)) {
        deleteGeneratedRelationshipTarget(dependent, relationship);
        return undefined;
    }
    const matchesRemembered = sameForeignKey(
        relationship, dependentBoundValues,
        remembered.currentExpectedProviderValues,
    );
    if (!matchesRemembered) {
        deleteGeneratedRelationshipTarget(dependent, relationship);
        return undefined;
    }
    if (remembered.kind === 'invalid') {
        throw staleGeneratedRelationshipTarget(dependent, relationship);
    }
    const { principal } = remembered;
    if (tracker.entry(principal.entity) !== principal) {
        deleteGeneratedRelationshipTarget(dependent, relationship);
        throw staleGeneratedRelationshipTarget(dependent, relationship);
    }

    const principalProperties = principalKeyProperties(
        relationship, principal,
    );
    const temporary = activeTemporaryGeneratedIdentity(
        principal, principalProperties,
    );
    if (!temporary) return undefined;
    if (remembered.currentValueIsFrameworkOwned &&
        navigation !== principal.entity) {
        throw ambiguousRestoredGeneratedRelationshipTarget(
            dependent, relationship,
        );
    }
    return principal;
}

/** Advance provenance only when generated-key rollback restored its write. */
export function generatedRelationshipTargetWasRestored(
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    principal: EntityEntry<object>,
    restoredProviderValues: readonly unknown[],
    frameworkWriteWasRestored: boolean,
): void {
    const remembered = generatedRelationshipTarget(dependent, relationship);
    if (remembered?.kind !== 'active' ||
        remembered.principal !== principal) return;
    if (!frameworkWriteWasRestored) {
        deleteGeneratedRelationshipTarget(dependent, relationship);
        return;
    }
    remembered.currentExpectedProviderValues = restoredProviderValues.map(
        cloneSnapshotValue,
    );
    remembered.currentValueIsFrameworkOwned = true;
}

export { deleteGeneratedRelationshipTarget };

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
