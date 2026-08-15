import { toBoundProviderValue } from '../model/value-converter/store-value';
import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import type { GeneratedIdentityRollbackSource } from './generated-identity-rollback-source';
import { rememberGeneratedRelationshipTarget } from './generated-relationship-target-provenance';
import { storeInvalidGeneratedRelationshipTarget } from './generated-relationship-target-store';
import {
    captureRelationshipDetectionValues,
    relationshipBoundValuesFor,
} from './relationship-detection-values';
import { snapshotValuesEqual } from './snapshot-value-equality';
import { cloneSnapshotValue } from './snapshot-value-clone';
import { temporaryGeneratedIdentity } from './temporary-generated-identity';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';
import { changeTrackerAllowsCrossTenantAccess } from './change-tracker-tenant-capability';
import { EntityState } from './entity-state';

/** Preserve or invalidate every tracked FK that observed a provisional identity. */
export function captureGeneratedRelationshipRollbackTargets(
    tracker: ChangeTracker,
    sources: readonly GeneratedIdentityRollbackSource[],
): void {
    if (sources.length === 0) return;
    const entries = tracker.entries().filter(entry =>
        entry.metadata.relationships.some(relationship =>
            sources.some(source =>
                source.entityType === relationship.principalEntity)));
    if (entries.length === 0) return;
    const captured = captureRelationshipDetectionValues(entries);
    for (const dependent of entries) {
        if (dependent.state === EntityState.Deleted ||
            dependent.state === EntityState.Detached) continue;
        for (const relationship of dependent.metadata.relationships as
            readonly TrackedRelationshipMetadata[]) {
            const candidates = sources.filter(source =>
                source.entityType === relationship.principalEntity &&
                relationshipUsesGeneratedValue(relationship, source));
            if (candidates.length === 0) continue;
            const bound = relationshipBoundValuesFor(dependent, captured);
            for (const source of candidates) {
                captureMatchingTarget(
                    tracker, dependent, relationship, bound, source,
                );
            }
        }
    }
}

function captureMatchingTarget(
    tracker: ChangeTracker,
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    dependentBoundValues: Readonly<Record<string, unknown>>,
    source: GeneratedIdentityRollbackSource,
): void {
    const expected = expectedForeignKeyValues(
        dependent, relationship, source,
    );
    if (!expected || !relationship.foreignKeyProperties.every(
        (property, index) => snapshotValuesEqual(
            dependentBoundValues[property], expected[index],
        ),
    )) return;
    if (!tenantMatches(tracker, dependent, dependentBoundValues, source)) {
        return;
    }
    const navigation = (dependent.entity as Record<string, unknown>)[
        relationship.navigationProperty
    ];
    if (navigation !== null && navigation !== undefined &&
        navigation !== source.entity) return;
    const principal = source.principal;
    if (principal && tracker.entry(source.entity) === principal &&
        temporaryGeneratedIdentity(principal)) {
        rememberGeneratedRelationshipTarget(
            dependent, relationship, principal, dependentBoundValues,
        );
        return;
    }
    storeInvalidGeneratedRelationshipTarget(
        dependent,
        relationship,
        expected,
        source.entity,
    );
}

function relationshipUsesGeneratedValue(
    relationship: TrackedRelationshipMetadata,
    source: GeneratedIdentityRollbackSource,
): boolean {
    return principalProperties(relationship, source).some(property =>
        source.generatedProperties.has(property));
}

function expectedForeignKeyValues(
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    source: GeneratedIdentityRollbackSource,
): readonly unknown[] | undefined {
    const principal = principalProperties(relationship, source);
    if (principal.some(property => !Object.hasOwn(
        source.boundValues, property,
    ))) return undefined;
    return relationship.foreignKeyProperties.map((propertyName, index) => {
        const property = dependent.metadata.getProperty(propertyName);
        return cloneSnapshotValue(toBoundProviderValue(
            source.boundValues[principal[index]],
            property.columnType,
            `${dependent.metadata.entityName}.${propertyName}`,
        ));
    });
}

function principalProperties(
    relationship: TrackedRelationshipMetadata,
    source: GeneratedIdentityRollbackSource,
): readonly string[] {
    return (relationship.principalKeyProperties ??
        source.keyProperties).map(String);
}

function tenantMatches(
    tracker: ChangeTracker,
    dependent: EntityEntry<object>,
    dependentBoundValues: Readonly<Record<string, unknown>>,
    source: GeneratedIdentityRollbackSource,
): boolean {
    if (changeTrackerAllowsCrossTenantAccess(tracker)) return true;
    const dependentTenant: unknown = dependent.metadata.tenantKeyProperty;
    const sourceTenant: unknown = source.tenantKeyProperty;
    if (typeof dependentTenant !== 'string' ||
        typeof sourceTenant !== 'string') return true;
    if (!Object.hasOwn(source.boundValues, sourceTenant)) return false;
    const property = dependent.metadata.getProperty(dependentTenant);
    const expected = toBoundProviderValue(
        source.boundValues[sourceTenant],
        property.columnType,
        `${dependent.metadata.entityName}.${dependentTenant}`,
    );
    return snapshotValuesEqual(
        dependentBoundValues[dependentTenant], expected,
    );
}
