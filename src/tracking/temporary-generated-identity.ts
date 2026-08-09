import type { PropertyMetadata } from '../model/property-metadata';
import { toProviderValue } from '../model/value-converter/store-value';
import type { EntityEntry } from './entity-entry';
import { EntityState } from './entity-state';
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
    property: PropertyMetadata,
    entityName: string,
): TemporaryGeneratedProperty {
    const providerValue = toProviderValue(
        value,
        property.converter,
        `${entityName}.${property.propertyName}`,
    );
    return {
        propertyName: property.propertyName,
        modelValue: value,
        providerValue,
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
    const expectedKey = temporary && entry.state === EntityState.Added
        ? temporary.identityKey
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

export function temporaryGeneratedProperty(
    entry: EntityEntry<object>,
    propertyName: string,
): TemporaryGeneratedProperty | undefined {
    return temporaryByEntry.get(entry)?.properties.find(
        property => property.propertyName === propertyName,
    );
}
