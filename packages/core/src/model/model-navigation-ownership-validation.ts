import type { EntityMetadata } from './entity-metadata';
import type { EntityConstructor } from '../types';

interface NavigationClaim {
    readonly property: string;
    readonly relationship: string;
}

/** Require one unambiguous relationship owner for every model navigation. */
export function validateModelNavigationOwnership(
    entities: readonly EntityMetadata[],
    entitiesByConstructor: ReadonlyMap<
        EntityConstructor<object>, EntityMetadata
    >,
): void {
    const claims: Map<EntityMetadata, Map<string, string>> = new Map();
    const claim = (
        entity: EntityMetadata,
        navigation: NavigationClaim,
    ): void => {
        const owned = claims.get(entity) ?? new Map<string, string>();
        const previous = owned.get(navigation.property);
        if (previous) {
            throw new Error(
                `Navigation '${entity.entityName}.${navigation.property}' ` +
                'is claimed by more than one relationship: ' +
                `'${previous}' and '${navigation.relationship}'.`,
            );
        }
        owned.set(navigation.property, navigation.relationship);
        claims.set(entity, owned);
    };

    for (const entity of entities) {
        for (const relationship of entity.relationships) {
            const name = `${entity.entityName}.${String(
                relationship.navigationProperty,
            )}`;
            claim(entity, {
                property: String(relationship.navigationProperty),
                relationship: name,
            });
            const principal = entitiesByConstructor.get(
                relationship.principalEntity,
            );
            const inverse: unknown = relationship.inverseNavigationProperty;
            if (principal && typeof inverse === 'string') {
                claim(principal, {
                    property: inverse,
                    relationship: name,
                });
            }
        }
        for (const relationship of entity.manyToManyRelationships) {
            const name = `${entity.entityName}.${String(
                relationship.navigationProperty,
            )}`;
            claim(entity, {
                property: String(relationship.navigationProperty),
                relationship: name,
            });
            const target = entitiesByConstructor.get(relationship.targetEntity);
            const inverse: unknown = relationship.inverseNavigationProperty;
            if (target && typeof inverse === 'string') {
                claim(target, {
                    property: inverse,
                    relationship: name,
                });
            }
        }
    }
}
