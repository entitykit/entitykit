import type { ModelSnapshot } from '../model/model-snapshot-types';

/** Clone every mutable collection a model-diff normalization pass may edit. */
export function cloneModelSnapshot(snapshot: ModelSnapshot): ModelSnapshot {
    return {
        ...snapshot,
        entities: snapshot.entities.map(entity => ({
            ...entity,
            properties: entity.properties.map(property => ({
                ...property,
                storeGeneration: property.storeGeneration
                    ? { ...property.storeGeneration }
                    : undefined,
            })),
            alternateKeys: entity.alternateKeys?.map(key => ({
                ...key,
                propertyNames: [...key.propertyNames],
            })) ?? [],
            indexes: entity.indexes.map(index => ({
                ...index,
                propertyNames: [...index.propertyNames],
                keyParts: index.keyParts?.map(part => ({ ...part })),
                includedPropertyNames: index.includedPropertyNames
                    ? [...index.includedPropertyNames]
                    : undefined,
            })),
            relationships: entity.relationships.map(relationship => ({
                ...relationship,
                foreignKeyProperties:
          relationship.foreignKeyProperties
              ? [...relationship.foreignKeyProperties]
              : undefined,
                principalKeyProperties:
          relationship.principalKeyProperties
              ? [...relationship.principalKeyProperties]
              : undefined,
            })),
            manyToManyRelationships:
        entity.manyToManyRelationships?.map(relationship => ({
            ...relationship,
        })) ?? [],
        })),
    };
}
