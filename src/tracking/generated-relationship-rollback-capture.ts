import { toBoundProviderValue } from '../model/value-converter/store-value';
import type { PersistedEntrySnapshot } from './persisted-entry-snapshot';
import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import { EntityState } from './entity-state';
import { rememberGeneratedRelationshipTarget } from './generated-relationship-target-provenance';
import {
    captureRelationshipDetectionValues,
    relationshipBoundValuesFor,
} from './relationship-detection-values';
import { snapshotValuesEqual } from './snapshot-value-equality';
import { cloneBoundValues } from './bound-value-snapshot';
import { cloneSnapshotValue } from './snapshot-value-clone';
import { temporaryGeneratedIdentity } from './temporary-generated-identity';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';
import { changeTrackerAllowsCrossTenantAccess } from './change-tracker-tenant-capability';

interface GeneratedPrincipalRollbackFact {
    readonly principal: EntityEntry<object>;
    readonly acceptedBoundValues: Readonly<Record<string, unknown>>;
    readonly generatedProperties: ReadonlySet<string>;
}

/** Capture accepted generated identities for a later outer rollback scan. */
export function captureGeneratedRelationshipRollback(
    tracker: ChangeTracker,
    snapshots: readonly PersistedEntrySnapshot[],
): () => void {
    const principals = snapshots.flatMap(snapshot => {
        const temporary = snapshot.state === EntityState.Added
            ? temporaryGeneratedIdentity(snapshot.entry)
            : undefined;
        return temporary ? [{
            principal: snapshot.entry,
            acceptedBoundValues: cloneBoundValues(snapshot.boundValues),
            generatedProperties: new Set(temporary.properties.map(
                property => property.propertyName,
            )),
        }] : [];
    });
    return () => {
        rememberUnplannedTargets(tracker, principals);
    };
}

function rememberUnplannedTargets(
    tracker: ChangeTracker,
    principals: readonly GeneratedPrincipalRollbackFact[],
): void {
    if (principals.length === 0) return;
    const entries = tracker.entries().filter(entry =>
        entry.metadata.relationships.some(relationship =>
            principals.some(fact => relationship.principalEntity ===
                fact.principal.metadata.ctor)),
    );
    const captured = captureRelationshipDetectionValues(entries);
    for (const dependent of entries) {
        if (dependent.state === EntityState.Deleted ||
            dependent.state === EntityState.Detached) continue;
        const bound = relationshipBoundValuesFor(dependent, captured);
        for (const relationship of dependent.metadata.relationships as
            readonly TrackedRelationshipMetadata[]) {
            for (const fact of principals) {
                rememberMatchingTarget(
                    tracker, dependent, relationship, bound, fact,
                );
            }
        }
    }
}

function rememberMatchingTarget(
    tracker: ChangeTracker,
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    bound: Readonly<Record<string, unknown>>,
    fact: GeneratedPrincipalRollbackFact,
): void {
    if (relationship.principalEntity !== fact.principal.metadata.ctor) return;
    const principalProperties = (relationship.principalKeyProperties ??
        fact.principal.metadata.keyProperties).map(String);
    if (!principalProperties.some(property =>
        fact.generatedProperties.has(property))) return;
    const expected = expectedForeignKeyValues(
        dependent, relationship, principalProperties, fact,
    );
    if (!relationship.foreignKeyProperties.every((property, index) =>
        snapshotValuesEqual(bound[property], expected[index]))) return;
    if (!tenantMatches(tracker, dependent, bound, fact)) return;
    const navigation = (dependent.entity as Record<string, unknown>)[
        relationship.navigationProperty
    ];
    if (navigation !== null && navigation !== undefined &&
        navigation !== fact.principal.entity) return;
    rememberGeneratedRelationshipTarget(
        dependent, relationship, fact.principal, bound,
    );
}

function expectedForeignKeyValues(
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    principalProperties: readonly string[],
    fact: GeneratedPrincipalRollbackFact,
): readonly unknown[] {
    return relationship.foreignKeyProperties.map((propertyName, index) => {
        const property = dependent.metadata.getProperty(propertyName);
        return cloneSnapshotValue(toBoundProviderValue(
            fact.acceptedBoundValues[principalProperties[index]],
            property.columnType,
            `${dependent.metadata.entityName}.${propertyName}`,
        ));
    });
}

function tenantMatches(
    tracker: ChangeTracker,
    dependent: EntityEntry<object>,
    bound: Readonly<Record<string, unknown>>,
    fact: GeneratedPrincipalRollbackFact,
): boolean {
    if (changeTrackerAllowsCrossTenantAccess(tracker)) return true;
    const dependentTenant: unknown = dependent.metadata.tenantKeyProperty;
    const principalTenant: unknown =
        fact.principal.metadata.tenantKeyProperty;
    if (typeof dependentTenant !== 'string' ||
        typeof principalTenant !== 'string') return true;
    const property = dependent.metadata.getProperty(dependentTenant);
    const expected = toBoundProviderValue(
        fact.acceptedBoundValues[principalTenant],
        property.columnType,
        `${dependent.metadata.entityName}.${dependentTenant}`,
    );
    return snapshotValuesEqual(bound[dependentTenant], expected);
}
