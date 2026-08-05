import type { PropertyMetadata } from '../model/property-metadata';
import { toProviderValue } from '../model/value-converter/store-value';
import type { EntityEntry } from './entity-entry';

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
