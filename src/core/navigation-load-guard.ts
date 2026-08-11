import type { ChangeTracker } from '../tracking/change-tracker';
import type { EntityEntry } from '../tracking/entity-entry';
import { EntityState } from '../tracking/entity-state';
import { assertNoKeyModifications } from './save-plan/immutable-key-change';
import {
    ForeignEntityEntryError,
    NavigationLoadUnavailableError,
} from '../errors/navigation-errors';
import { cloneSnapshotValue } from '../tracking/snapshot-value-clone';
import { snapshotValuesEqual } from '../tracking/snapshot-value-equality';
import { TenantOwnershipError } from '../errors/tenant-ownership-error';
import {
    captureEntityPersistenceFacts,
    capturePropertyPersistenceFact,
} from '../tracking/entity-persistence-fact-capture';
import { readPropertyValue } from '../model/property-value-access';

export interface NavigationLoadSnapshot {
    readonly modelValues: Readonly<Record<string, unknown>>;
    readonly boundValues: Readonly<Record<string, unknown>>;
}

/** Require a navigation target to be the context's current persisted entry. */
export function assertNavigationEntryTracked<TEntity extends object>(
    tracker: ChangeTracker,
    entry: EntityEntry<TEntity>,
): void {
    if (tracker.entry(entry.entity) !== entry) {
        throw new ForeignEntityEntryError();
    }
    if (entry.state === EntityState.Added) {
        throw new NavigationLoadUnavailableError(
            'added',
            entry.metadata.entityName,
        );
    }
}

/** Capture and validate the immutable values used by one navigation load. */
export function captureNavigationLoadValues<TEntity extends object>(
    tracker: ChangeTracker,
    entry: EntityEntry<TEntity>,
    navigationProperty: string,
    boundTenantId: unknown,
    allowsCrossTenantAccess: boolean,
): NavigationLoadSnapshot {
    assertNavigationEntryTracked(tracker, entry);
    const identityProperties = navigationIdentityProperties(entry);
    const reference = entry.metadata.relationships.find(relationship =>
        relationship.navigationProperty === navigationProperty,
    );
    const referenceProperties = new Set(
        reference?.foreignKeyProperties.map(String) ?? [],
    );
    const current = captureEntityPersistenceFacts(
        entry.metadata,
        entry.entity,
        identityProperties,
    );
    for (const propertyName of referenceProperties) {
        if (identityProperties.has(propertyName)) continue;
        const property = entry.metadata.getProperty(propertyName);
        const liveValue = readPropertyValue(entry.entity, property);
        if (snapshotValuesEqual(
            liveValue,
            entry.originalValues[propertyName],
        )) {
            continue;
        }
        const captured = capturePropertyPersistenceFact(
            entry.metadata, property, liveValue,
        );
        current.modelValues[propertyName] = captured.modelValue;
        current.boundValues[propertyName] = captured.boundValue;
    }
    const currentValues = { ...entry.originalValues };
    assertNoKeyModifications(
        entry as unknown as EntityEntry<object>,
        [...identityProperties].filter(propertyName =>
            !snapshotValuesEqual(
                current.boundValues[propertyName],
                entry.originalBoundValues[propertyName],
            )),
    );

    const persisted: Set<string> = new Set([
        ...entry.metadata.keyProperties,
        ...entry.metadata.alternateKeys.flatMap(key => key.propertyNames),
        ...entry.metadata.relationships.flatMap(
            relationship => relationship.foreignKeyProperties as readonly string[],
        ),
    ]);
    if (entry.metadata.tenantKeyProperty) {
        persisted.add(entry.metadata.tenantKeyProperty);
    }
    const boundValues: Record<string, unknown> = {};
    for (const propertyName of persisted) {
        const useCurrent = referenceProperties.has(propertyName) &&
            Object.prototype.hasOwnProperty.call(
                current.boundValues, propertyName,
            );
        const sourceValues = useCurrent
            ? current.modelValues
            : entry.originalValues;
        const sourceBoundValues = useCurrent
            ? current.boundValues
            : entry.originalBoundValues;
        currentValues[propertyName] = sourceValues[propertyName];
        if (!Object.prototype.hasOwnProperty.call(sourceBoundValues, propertyName)) {
            throw new Error(
                `Navigation loading for '${entry.metadata.entityName}' ` +
                `has no bound fact for '${propertyName}'.`,
            );
        }
        boundValues[propertyName] = cloneSnapshotValue(
            sourceBoundValues[propertyName],
        );
    }
    const tenantProperty = entry.metadata.tenantKeyProperty;
    if (
        tenantProperty &&
        !allowsCrossTenantAccess &&
        !snapshotValuesEqual(boundValues[tenantProperty], boundTenantId)
    ) {
        throw new TenantOwnershipError(
            entry.metadata.entityName,
            tenantProperty,
            'scope-mismatch',
        );
    }
    return { modelValues: currentValues, boundValues };
}

function navigationIdentityProperties<TEntity extends object>(
    entry: EntityEntry<TEntity>,
): Set<string> {
    return new Set([
        ...entry.metadata.keyProperties.map(String),
        ...entry.metadata.alternateKeys.flatMap(
            key => key.propertyNames.map(String),
        ),
    ]);
}
