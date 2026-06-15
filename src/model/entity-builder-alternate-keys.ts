import type { EntityConstructor, EntityPropertyKey } from '../types';
import { AlternateKeyBuilderImplementation } from './alternate-key-builder';
import type { AlternateKeyBuilder } from './index-builder-types';
import type {
    AlternateKeyMetadata,
    MutableAlternateKeyMetadata,
} from './alternate-key-metadata';
import type { EntityBuilderProperties } from './entity-builder-properties';
import type { PropertyListSelector } from './model-property-selector';
import { selectPropertyNames } from './model-property-selector';
import type { PropertyMetadata } from './property-metadata';
import { orderedEqual } from '../collections/ordered-equality';

export class EntityBuilderAlternateKeys<TEntity extends object> {
    private readonly alternateKeys: Array<MutableAlternateKeyMetadata<TEntity>> = [];

    constructor(
        private readonly ctor: EntityConstructor<TEntity>,
        private readonly properties: EntityBuilderProperties<TEntity>,
    ) {}

    public alternateKey(
        propertyOrSelector:
        EntityPropertyKey<TEntity> | PropertyListSelector<TEntity>,
    ): AlternateKeyBuilder {
        const propertyNames = typeof propertyOrSelector === 'function'
            ? selectPropertyNames(propertyOrSelector)
            : [this.properties.resolvePropertyName(propertyOrSelector)];
        const seen: Set<EntityPropertyKey<TEntity>> = new Set();
        for (const propertyName of propertyNames) {
            if (seen.has(propertyName)) {
                throw new Error(
                    `Alternate key of entity '${this.ctor.name}' lists property '${propertyName}' more than once.`,
                );
            }
            seen.add(propertyName);
            this.properties.assertNotIgnored(propertyName);
            this.properties.ensureProperty(propertyName);
        }
        const key: MutableAlternateKeyMetadata<TEntity> = {
            propertyNames: [...propertyNames],
        };
        this.alternateKeys.push(key);
        return new AlternateKeyBuilderImplementation(key);
    }

    public finalize(
        properties: ReadonlyArray<PropertyMetadata<TEntity>>,
        primaryKey: ReadonlyArray<EntityPropertyKey<TEntity>>,
    ): Array<AlternateKeyMetadata<TEntity>> {
        const propertyNames = new Set(properties.map(item => item.propertyName));
        const identities: Set<string> = new Set();
        return this.alternateKeys.map(key => {
            for (const propertyName of key.propertyNames) {
                if (!propertyNames.has(propertyName)) {
                    throw new Error(
                        `Alternate key on entity '${this.ctor.name}' references unconfigured property '${propertyName}'.`,
                    );
                }
            }
            const identity = key.propertyNames.join('\0');
            if (orderedEqual(key.propertyNames, primaryKey)) {
                throw new Error(
                    `Alternate key on entity '${this.ctor.name}' duplicates its primary key.`,
                );
            }
            if (identities.has(identity)) {
                throw new Error(
                    `Entity '${this.ctor.name}' configures the same alternate key more than once.`,
                );
            }
            identities.add(identity);
            return {
                propertyNames: [...key.propertyNames],
                databaseName: key.databaseName,
            };
        });
    }
}
