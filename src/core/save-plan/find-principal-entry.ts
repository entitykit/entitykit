import type { RelationshipMetadata } from '../../model/relationship-metadata';
import type { EntityConstructor } from '../../types';
import type { PersistedEntrySnapshot } from '../../tracking/persisted-entry-snapshot';
import { encodeSaveIdentityTuple } from '../save-key-values';

export function findPrincipalEntry(
    relationship: RelationshipMetadata,
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
    const target = encodeSaveIdentityTuple(foreignKeyValues);
    return entriesByType.get(relationship.principalEntity)
        ?.find(snapshot => {
            const { entry } = snapshot;
            const propertyNames = relationship.principalKeyProperties ??
                entry.metadata.keyProperties;
            const keyValues = propertyNames.map(property =>
                snapshot.values[property]);
            return encodeSaveIdentityTuple(keyValues) === target;
        });
}
