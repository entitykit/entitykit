import type { PropertyMetadata } from '../model/property-metadata';
import type { EntityEntry } from './entity-entry';
import { EntityState } from './entity-state';
import { cloneSnapshotValue } from './snapshot-value-clone';
import { trackingIdentityKeyForBoundValues } from './tracking-identity-key';
import { trackingIdentityKeyForEntry } from './tracking-identity-key';

export interface TemporaryGeneratedProperty {
    readonly propertyName: string;
    readonly modelValue: unknown;
    readonly providerValue: unknown;
}

export interface TemporaryGeneratedIdentity {
    readonly identityKey: string;
    readonly properties: readonly TemporaryGeneratedProperty[];
}

const temporaryByEntry: WeakMap<
    EntityEntry<object>,
    TemporaryGeneratedIdentity
> = new WeakMap();

export function captureTemporaryGeneratedProperty(
    value: unknown,
    boundValue: unknown,
    property: PropertyMetadata,
): TemporaryGeneratedProperty {
    return {
        propertyName: property.propertyName,
        modelValue: value,
        providerValue: cloneSnapshotValue(boundValue),
    };
}

export function registerTemporaryGeneratedIdentity(
    entry: EntityEntry<object>,
    identity: TemporaryGeneratedIdentity | undefined,
): void {
    if (identity) {
        temporaryByEntry.set(entry, identity);
    } else {
        temporaryByEntry.delete(entry);
    }
}

export function clearTemporaryGeneratedIdentity(
    entry: EntityEntry<object>,
): void {
    temporaryByEntry.delete(entry);
}

export function assertNoUnresolvedGeneratedIdentities(
    entries: ReadonlyArray<EntityEntry<object>>,
): void {
    const unresolved = entries.find(entry =>
        entry.state === EntityState.Added && temporaryByEntry.has(entry));
    if (!unresolved) return;

    throw new Error(
        `Cannot accept all changes while '${unresolved.metadata.entityName}' ` +
        'has an unresolved store-generated identity. Save or detach it first.',
    );
}

export function assertTrackingIdentityRegistration(
    entry: EntityEntry<object>,
    registeredKey: string | undefined,
): void {
    const temporary = temporaryByEntry.get(entry);
    const identityProperties = [...entry.metadata.keyPropertiesMetadata];
    const tenantProperty = entry.metadata.tenantKeyProperty as
        string | undefined;
    if (
        tenantProperty !== undefined &&
        !(entry.metadata.keyProperties as readonly string[]).includes(
            tenantProperty,
        )
    ) {
        identityProperties.push(entry.metadata.getProperty(tenantProperty));
    }
    const usesBoundIdentity = identityProperties.some(property => {
        const columnType = property.columnType.trim().toLowerCase();
        return property.converter !== undefined ||
            columnType === 'json' || columnType === 'jsonb';
    });
    const expectedKey = temporary && entry.state === EntityState.Added
        ? temporary.identityKey
        : usesBoundIdentity
            ? trackingIdentityKeyForBoundValues(
                entry.metadata,
                entry.originalBoundValues,
            )
            : trackingIdentityKeyForEntry(entry, entry.originalValues);
    if (registeredKey !== expectedKey) {
        throw new Error(
            'Tracking identity invariant failed for tracked ' +
            `'${entry.metadata.entityName}'.`,
        );
    }
}

export function temporaryGeneratedIdentity(
    entry: EntityEntry<object>,
): TemporaryGeneratedIdentity | undefined {
    return temporaryByEntry.get(entry);
}

/** Return rollback metadata only while its generated identity is unresolved. */
export function activeTemporaryGeneratedIdentity(
    entry: EntityEntry<object>,
    propertyNames?: readonly string[],
): TemporaryGeneratedIdentity | undefined {
    if (entry.state !== EntityState.Added) return undefined;
    const temporary = temporaryByEntry.get(entry);
    if (!temporary || propertyNames === undefined) return temporary;
    return propertyNames.some(propertyName => temporary.properties.some(
        property => property.propertyName === propertyName,
    ))
        ? temporary
        : undefined;
}

export function temporaryGeneratedProperty(
    entry: EntityEntry<object>,
    propertyName: string,
): TemporaryGeneratedProperty | undefined {
    return temporaryByEntry.get(entry)?.properties.find(
        property => property.propertyName === propertyName,
    );
}
