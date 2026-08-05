import { relationshipPrincipalKeyProperties } from '../../model/relationship-key';
import { isGeneratedOnAdd } from '../../model/value-generated';
import type { PersistedEntrySnapshot } from '../../tracking/persisted-entry-snapshot';
import { EntityState } from '../../tracking/entity-state';
import type { GeneratedKeyPropagation } from '../save-plan-execution';

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
            )) ||
            !relationship.foreignKeyProperties.some(propertyName =>
                isEmpty(dependent.values[propertyName]))) {
            return [];
        }
        return [{
            principal: principal.entry.entity,
            principalMetadata: principal.entry.metadata,
            principalKeyProperties: principalKeyProperties.map(String),
            principalKeyValues: principalKeyProperties.map(propertyName =>
                principal.values[propertyName]),
            foreignKeyProperties: relationship.foreignKeyProperties.map(String),
        }];
    });
    return propagations.length > 0 ? propagations : undefined;
}

function isEmpty(value: unknown): boolean {
    return value === undefined || value === null || value === '';
}
