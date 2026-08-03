import type { PropertyMetadata } from '../../model/property-metadata';
import type { SavePlanEntry } from '../save-plan';
import type { SaveTimeMutationLog } from '../save-time-mutations';
import type { GeneratedKeyPropagation } from '../save-plan-execution';
import type { AppliedPropertyValue } from './applied-generated-value';

/** Copy hydrated principal keys into empty foreign keys before dependent SQL. */
export function propagateGeneratedKeys(
    entry: SavePlanEntry,
    persistedValues: Record<string, unknown>,
    mutations: SaveTimeMutationLog,
    propagations: readonly GeneratedKeyPropagation[] = [],
    generatedValue: (
        principal: object,
        propertyName: string,
    ) => AppliedPropertyValue | undefined,
): readonly AppliedPropertyValue[] {
    const liveValues = entry.entity as Record<string, unknown>;
    const applied: AppliedPropertyValue[] = [];
    for (const propagation of propagations) {
        const keyValues = propagation.principalKeyProperties.map(
            (propertyName, index) =>
                generatedValue(propagation.principal, propertyName)
                    ?.persistedValue ?? propagation.principalKeyValues[index],
        );
        propagation.foreignKeyProperties.forEach((propertyName, index) => {
            if (hasValue(persistedValues, { propertyName })) {
                return;
            }
            const value = keyValues[index];
            if (value === undefined || value === null || value === '') {
                throw new Error(
                    `Cannot insert '${entry.entityName}' because the database-generated key for '${propagation.principalMetadata.entityName}' was not available.`,
                );
            }
            if (!hasValue(liveValues, { propertyName })) {
                mutations.record(liveValues, propertyName);
                liveValues[propertyName] = value;
            }
            persistedValues[propertyName] = value;
            applied.push({ propertyName, persistedValue: value });
        });
    }
    return applied;
}

function hasValue(
    entity: object,
    property: Pick<PropertyMetadata, 'propertyName'>,
): boolean {
    const value = (entity as Record<string, unknown>)[property.propertyName];
    return value !== undefined && value !== null && value !== '';
}
