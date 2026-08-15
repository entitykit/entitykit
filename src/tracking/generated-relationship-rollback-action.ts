import { toBoundProviderValue } from '../model/value-converter/store-value';
import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import type { GeneratedIdentityRollbackSource } from './generated-identity-rollback-source';
import { rememberGeneratedRelationshipTarget } from './generated-relationship-target-provenance';
import { storeInvalidGeneratedRelationshipTarget } from './generated-relationship-target-store';
import { snapshotValuesEqual } from './snapshot-value-equality';
import { cloneSnapshotValue } from './snapshot-value-clone';
import { temporaryGeneratedIdentity } from './temporary-generated-identity';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';
import { changeTrackerAllowsCrossTenantAccess } from './change-tracker-tenant-capability';

/** Inspect one candidate without mutating rollback provenance. */
export function prepareGeneratedRelationshipRollbackAction(
    tracker: ChangeTracker,
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    dependentBoundValues: Readonly<Record<string, unknown>>,
    source: GeneratedIdentityRollbackSource,
): (() => void) | undefined {
    if (!usesGeneratedValue(relationship, source)) return undefined;
    const expected = expectedForeignKeyValues(
        dependent, relationship, source,
    );
    if (!expected || !relationship.foreignKeyProperties.every(
        (property, index) => snapshotValuesEqual(
            dependentBoundValues[property], expected[index],
        ),
    )) return undefined;
    if (!tenantMatches(tracker, dependent, dependentBoundValues, source)) {
        return undefined;
    }
    const navigation = (dependent.entity as Record<string, unknown>)[
        relationship.navigationProperty
    ];
    if (navigation !== null && navigation !== undefined &&
        navigation !== source.entity) return undefined;
    const principal = source.principal;
    if (principal && tracker.entry(source.entity) === principal &&
        temporaryGeneratedIdentity(principal)) {
        return () => {
            rememberGeneratedRelationshipTarget(
                dependent, relationship, principal, dependentBoundValues,
            );
        };
    }
    return () => {
        storeInvalidGeneratedRelationshipTarget(
            dependent,
            relationship,
            expected,
            source.entity,
        );
    };
}

function usesGeneratedValue(
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
