import type { RelationshipMetadata } from '../../model/relationship-metadata';
import type { EntityConstructor } from '../../types';
import type { EntityEntry } from '../../tracking/entity-entry';
import { formatSaveIdentityValue } from '../save-key-values';

export function findPrincipalEntry(
    relationship: RelationshipMetadata,
    values: Readonly<Record<string, unknown>>,
    entriesByType: ReadonlyMap<
        EntityConstructor<object>,
        ReadonlyArray<EntityEntry<object>>
    >,
    entriesByEntity: ReadonlyMap<object, EntityEntry<object>>,
): EntityEntry<object> | undefined {
    const principalByNavigation = entriesByEntity.get(
        values[relationship.navigationProperty] as object,
    );
    if (principalByNavigation) {
        return principalByNavigation;
    }

    const foreignKeyValues = relationship.foreignKeyProperties
        .map(propertyName => values[propertyName]);
    if (foreignKeyValues.some(value => value === undefined || value === null)) {
        return undefined;
    }
    const target = formatSaveIdentityValue(
        foreignKeyValues.length === 1
            ? foreignKeyValues[0]
            : foreignKeyValues,
    );
    return entriesByType.get(relationship.principalEntity)
        ?.find(entry => {
            const propertyNames = relationship.principalKeyProperties ??
                entry.metadata.keyProperties;
            const principal = entry.entity as Record<string, unknown>;
            const keyValues = propertyNames.map(property => principal[property]);
            return formatSaveIdentityValue(
                keyValues.length === 1 ? keyValues[0] : keyValues,
            ) === target;
        });
}
