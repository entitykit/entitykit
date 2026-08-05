import { relationshipPrincipalKeyProperties } from '../../model/relationship-key';
import { isGeneratedOnAdd } from '../../model/value-generated';
import type { PersistedEntrySnapshot } from '../../tracking/persisted-entry-snapshot';
import { EntityState } from '../../tracking/entity-state';
import type { GeneratedKeyPropagation } from '../save-plan-execution';
import { temporaryGeneratedProperty } from '../../tracking/temporary-generated-identity';
import { toProviderValue } from '../../model/value-converter/store-value';

export function generatedKeyPropagations(
    dependent: PersistedEntrySnapshot,
    entriesByEntity: ReadonlyMap<object, PersistedEntrySnapshot>,
): readonly GeneratedKeyPropagation[] | undefined {
    if (dependent.state !== EntityState.Added) {
        return undefined;
    }
    const { entry } = dependent;
    const propagations = entry.metadata.relationships.flatMap(relationship => {
        const principal = entriesByEntity.get(
            dependent.relationshipValues[
                String(relationship.navigationProperty)
            ] as object,
        );
        const principalKeyProperties = principal
            ? relationshipPrincipalKeyProperties(
                relationship, principal.entry.metadata,
            )
            : [];
        if (principal?.state !== EntityState.Added ||
            !principalKeyProperties.some(propertyName => isGeneratedOnAdd(
                principal.entry.metadata.getProperty(propertyName).valueGenerated,
            ))) {
            return [];
        }
        const properties = relationship.foreignKeyProperties.flatMap((
            foreignKeyProperty,
            index,
        ) => {
            const principalProperty = String(principalKeyProperties[index]);
            const foreignKeyName = String(foreignKeyProperty);
            const foreignKeyValue = dependent.values[foreignKeyName];
            const temporary = temporaryGeneratedProperty(
                principal.entry,
                principalProperty,
            );
            if (
                !isMissing(foreignKeyValue) &&
                !matchesTemporaryValue(
                    foreignKeyValue,
                    dependent,
                    foreignKeyName,
                    temporary?.providerValue,
                )
            ) {
                return [];
            }
            return [{
                principalProperty,
                principalValue: principal.values[principalProperty],
                foreignKeyProperty: foreignKeyName,
                foreignKeyValue,
            }];
        });
        if (properties.length === 0) {
            return [];
        }
        return [{
            principal: principal.entry.entity,
            principalMetadata: principal.entry.metadata,
            properties,
        }];
    });
    return propagations.length > 0 ? propagations : undefined;
}

function isMissing(value: unknown): boolean {
    return value === undefined || value === null || value === '';
}

function matchesTemporaryValue(
    value: unknown,
    dependent: PersistedEntrySnapshot,
    propertyName: string,
    temporaryProviderValue: unknown,
): boolean {
    if (temporaryProviderValue === undefined) {
        return false;
    }
    const property = dependent.entry.metadata.getProperty(propertyName);
    const providerValue = toProviderValue(
        value,
        property.converter,
        `${dependent.entry.metadata.entityName}.${propertyName}`,
    );
    return Object.is(providerValue, temporaryProviderValue);
}
