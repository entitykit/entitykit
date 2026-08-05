import type { RelationshipMetadata } from '../../model/relationship-metadata';
import type { EntityMetadata } from '../../model/entity-metadata';
import type { EntityConstructor } from '../../types';
import type { PersistedEntrySnapshot } from '../../tracking/persisted-entry-snapshot';
import {
    dependentRelationshipProviderKey,
    principalRelationshipProviderKey,
} from '../../model/relationship-key-codec';

export function findPrincipalEntry(
    relationship: RelationshipMetadata,
    dependentMetadata: EntityMetadata,
    values: Readonly<Record<string, unknown>>,
    entriesByType: ReadonlyMap<
        EntityConstructor<object>,
        readonly PersistedEntrySnapshot[]
    >,
    entriesByEntity: ReadonlyMap<object, PersistedEntrySnapshot>,
): PersistedEntrySnapshot | undefined {
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
    const target = dependentRelationshipProviderKey(
        relationship,
        dependentMetadata,
        values,
    );
    return entriesByType.get(relationship.principalEntity)
        ?.find(snapshot => {
            const { entry } = snapshot;
            return principalRelationshipProviderKey(
                relationship,
                entry.metadata,
                snapshot.values,
            ) === target;
        });
}
