import type { RelationshipMetadata } from '../../model/relationship-metadata';
import type { EntityConstructor } from '../../types';
import type { PersistedEntrySnapshot } from '../../tracking/persisted-entry-snapshot';
import { formatSaveIdentityValue } from '../save-key-values';

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
    const target = formatSaveIdentityValue(
        foreignKeyValues.length === 1
            ? foreignKeyValues[0]
            : foreignKeyValues,
    );
    return entriesByType.get(relationship.principalEntity)
        ?.find(snapshot => {
            const { entry } = snapshot;
            const propertyNames = relationship.principalKeyProperties ??
                entry.metadata.keyProperties;
            const keyValues = propertyNames.map(property =>
                snapshot.values[property]);
            return formatSaveIdentityValue(
                keyValues.length === 1 ? keyValues[0] : keyValues,
            ) === target;
        });
}
