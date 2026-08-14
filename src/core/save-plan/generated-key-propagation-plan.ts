import { relationshipPrincipalKeyProperties } from '../../model/relationship-key';
import { isGeneratedOnAdd } from '../../model/value-generated';
import type { PersistedEntrySnapshot } from '../../tracking/persisted-entry-snapshot';
import { EntityState } from '../../tracking/entity-state';
import type { GeneratedKeyPropagation } from '../save-plan-execution';
import {
    activeTemporaryGeneratedIdentity,
    type TemporaryGeneratedProperty,
} from '../../tracking/temporary-generated-identity';
import { snapshotValuesEqual } from '../../tracking/snapshot-value-equality';

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
            const generated = isGeneratedOnAdd(
                principal.entry.metadata.getProperty(
                    principalProperty,
                ).valueGenerated,
            );
            const temporary = activeTemporaryGeneratedIdentity(
                principal.entry, [principalProperty],
            )?.properties.find(property =>
                property.propertyName === principalProperty);
            if (
                !isMissing(foreignKeyValue) &&
                !matchesTemporaryValue(
                    dependent,
                    foreignKeyName,
                    temporary,
                ) && !(
                    generated && matchesPrincipalValue(
                        dependent,
                        foreignKeyName,
                        principal,
                        principalProperty,
                    )
                )
            ) {
                return [];
            }
            return [{
                principalProperty,
                principalValue: principal.values[principalProperty],
                principalBoundValue:
                    principal.boundValues[principalProperty],
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
            dependentMetadata: dependent.entry.metadata,
            properties,
        }];
    });
    return propagations.length > 0 ? propagations : undefined;
}

function matchesPrincipalValue(
    dependent: PersistedEntrySnapshot,
    foreignKeyName: string,
    principal: PersistedEntrySnapshot,
    principalPropertyName: string,
): boolean {
    return snapshotValuesEqual(
        dependent.boundValues[foreignKeyName],
        principal.boundValues[principalPropertyName],
    );
}

function isMissing(value: unknown): boolean {
    return value === undefined || value === null || value === '';
}

function matchesTemporaryValue(
    dependent: PersistedEntrySnapshot,
    propertyName: string,
    temporary: TemporaryGeneratedProperty | undefined,
): boolean {
    if (!temporary) {
        return false;
    }
    return snapshotValuesEqual(
        dependent.boundValues[propertyName],
        temporary.providerValue,
    );
}
