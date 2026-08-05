import type { SavePlanEntry } from '../save-plan';
import type { SaveTimeMutationLog } from '../save-time-mutations';
import type { GeneratedKeyPropagation } from '../save-plan-execution';
import type { AppliedPropertyValue } from './applied-generated-value';
import { isGeneratedOnAdd } from '../../model/value-generated';

/** Copy hydrated principal keys into empty foreign keys before dependent SQL. */
export function propagateGeneratedKeys(
    entry: SavePlanEntry,
    persistedValues: Record<string, unknown>,
    mutations: SaveTimeMutationLog,
    propagations: readonly GeneratedKeyPropagation[] = [],
    findGeneratedValue: (
        principal: object,
        propertyName: string,
    ) => AppliedPropertyValue | undefined,
): readonly AppliedPropertyValue[] {
    const liveValues = entry.entity as Record<string, unknown>;
    const applied: AppliedPropertyValue[] = [];
    for (const propagation of propagations) {
        for (const property of propagation.properties) {
            if (!Object.is(
                persistedValues[property.foreignKeyProperty],
                property.foreignKeyValue,
            )) {
                continue;
            }
            const generated = findGeneratedValue(
                propagation.principal,
                property.principalProperty,
            );
            const requiresGeneratedValue = isGeneratedOnAdd(
                propagation.principalMetadata.getProperty(
                    property.principalProperty,
                ).valueGenerated,
            );
            const generatedValue = generated?.persistedValue;
            const hasGeneratedValue = generatedValue !== undefined &&
                generatedValue !== null && generatedValue !== '';
            const value = hasGeneratedValue
                ? generatedValue
                : property.principalValue;
            if (requiresGeneratedValue && !hasGeneratedValue) {
                throw new Error(
                    `Cannot insert '${entry.entityName}' because the database-generated key for '${propagation.principalMetadata.entityName}' was not available.`,
                );
            }
            if (value === undefined || value === null || value === '') {
                throw new Error(
                    `Cannot insert '${entry.entityName}' because the database-generated key for '${propagation.principalMetadata.entityName}' was not available.`,
                );
            }
            if (Object.is(
                liveValues[property.foreignKeyProperty],
                property.foreignKeyValue,
            )) {
                mutations.record(liveValues, property.foreignKeyProperty);
                liveValues[property.foreignKeyProperty] = value;
            }
            persistedValues[property.foreignKeyProperty] = value;
            applied.push({
                propertyName: property.foreignKeyProperty,
                persistedValue: value,
            });
        }
    }
    return applied;
}
