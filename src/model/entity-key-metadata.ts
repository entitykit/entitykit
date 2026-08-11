import type { EntityPropertyKey } from '../types';
import { encodeIdentityTuple } from './identity-value';
import { readStoreValue, type StoreValueReader } from '../storage/store-value-reader';
import type { PropertyMetadata } from './property-metadata';
import { toProviderValue } from './value-converter/store-value';

export class EntityKeyMetadata<TEntity extends object> {
    constructor(
        private readonly entityName: string,
        private readonly keyProperties: ReadonlyArray<EntityPropertyKey<TEntity>>,
        private readonly propertiesByName: ReadonlyMap<
            string,
            PropertyMetadata<TEntity>
        >,
    ) {}

    public get hasCompositeKey(): boolean {
        return this.keyProperties.length > 1;
    }

    public get keyProperty(): EntityPropertyKey<TEntity> {
        this.assertSingleKey('keyProperty');
        return this.keyProperties[0];
    }

    public get keyPropertyMetadata(): PropertyMetadata<TEntity> {
        return this.getProperty(this.keyProperty);
    }

    public get keyPropertiesMetadata(): ReadonlyArray<PropertyMetadata<TEntity>> {
        return this.keyProperties.map(propertyName =>
            this.getProperty(propertyName),
        );
    }

    public assertSingleKey(feature: string): void {
        if (this.hasCompositeKey) {
            throw new Error(
                `Entity '${this.entityName}' has a composite key (${this.keyProperties.join(', ')}), which ${feature} does not support yet.`,
            );
        }
    }

    public getKeyValue(entity: TEntity): unknown {
        return (entity as Record<string, unknown>)[this.keyProperty];
    }

    public getKeyValues(entity: TEntity): unknown[] {
        return this.keyProperties.map(
            propertyName =>
                (entity as Record<string, unknown>)[propertyName],
        );
    }

    public getKeyValuesFromRow(
        row: Record<string, unknown>,
        valueReader?: StoreValueReader,
    ): unknown[] {
        return this.keyPropertiesMetadata.map(property =>
            readStoreValue(
                row[property.columnName], property, valueReader, this.entityName,
            ),
        );
    }

    public readKeyValue(
        value: unknown,
        valueReader?: StoreValueReader,
    ): unknown {
        return readStoreValue(
            value,
            this.keyPropertyMetadata,
            valueReader,
            this.entityName,
        );
    }

    public getKeyValueFromRow(
        row: Record<string, unknown>,
        valueReader?: StoreValueReader,
    ): unknown {
        return this.readKeyValue(
            row[this.keyPropertyMetadata.columnName],
            valueReader,
        );
    }

    public createIdentityKey(entity: TEntity): string {
        return this.createIdentityKeyFromValues(this.getKeyValues(entity));
    }

    public createIdentityKeyFromValue(keyValue: unknown): string {
        return this.createIdentityKeyFromValues([keyValue]);
    }

    public createIdentityKeyFromValues(
        keyValues: readonly unknown[],
    ): string {
        if (keyValues.length !== this.keyProperties.length) {
            throw new Error(
                `Entity '${this.entityName}' has ${String(this.keyProperties.length)} key ${this.keyProperties.length === 1 ? 'property' : 'properties'} (${this.keyProperties.join(', ')}), but ${String(keyValues.length)} key ${keyValues.length === 1 ? 'value was' : 'values were'} supplied.`,
            );
        }

        const providerValues = keyValues.map((keyValue, index) =>
            toProviderValue(
                keyValue,
                this.keyPropertiesMetadata[index].converter,
                `${this.entityName}.${this.keyProperties[index]}`,
            ));
        return this.createIdentityKeyFromProviderValues(providerValues);
    }

    public createIdentityKeyFromProviderValues(
        providerValues: readonly unknown[],
    ): string {
        if (providerValues.length !== this.keyProperties.length) {
            throw new Error(
                `Entity '${this.entityName}' has ${String(this.keyProperties.length)} key ${this.keyProperties.length === 1 ? 'property' : 'properties'} (${this.keyProperties.join(', ')}), but ${String(providerValues.length)} provider ${providerValues.length === 1 ? 'value was' : 'values were'} supplied.`,
            );
        }
        providerValues.forEach((keyValue, index) => {
            if (
                keyValue === undefined ||
        keyValue === null ||
        keyValue === ''
            ) {
                throw new Error(
                    `Entity '${this.entityName}' has an empty key value for '${this.keyProperties[index]}'.`,
                );
            }
        });

        return `${this.entityName}:${encodeIdentityTuple(providerValues)}`;
    }

    private getProperty(
        propertyName: EntityPropertyKey<TEntity>,
    ): PropertyMetadata<TEntity> {
        const property = this.propertiesByName.get(propertyName);
        if (!property) {
            throw new Error(
                `Property '${propertyName}' is not configured on entity '${this.entityName}'.`,
            );
        }
        return property;
    }
}
