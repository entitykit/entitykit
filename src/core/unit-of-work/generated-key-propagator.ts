import type { SavePlanEntry } from '../save-plan';
import type { SaveTimeMutationLog } from '../save-time-mutations';
import type { GeneratedKeyPropagation } from '../save-plan-execution';
import type { AppliedPropertyValue } from './applied-generated-value';
import { isGeneratedOnAdd } from '../../model/value-generated';
import {
    snapshotPropertyValueCopies,
    snapshotPropertyValuesEqual,
} from '../../tracking/snapshot-value';

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
            const foreignKey = propagation.dependentMetadata.getProperty(
                property.foreignKeyProperty,
            );
            const context = `${entry.entityName}.${property.foreignKeyProperty}`;
            if (!snapshotPropertyValuesEqual(
                persistedValues[property.foreignKeyProperty],
                property.foreignKeyValue,
                foreignKey.converter,
                context,
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
            const { persistedValue, liveValue } = snapshotPropertyValueCopies(
                value,
                foreignKey.converter,
                context,
            );
            if (snapshotPropertyValuesEqual(
                liveValues[property.foreignKeyProperty],
                property.foreignKeyValue,
                foreignKey.converter,
                context,
            )) {
                mutations.record(liveValues, property.foreignKeyProperty);
                liveValues[property.foreignKeyProperty] = liveValue;
            }
            persistedValues[property.foreignKeyProperty] = persistedValue;
            applied.push({
                propertyName: property.foreignKeyProperty,
                persistedValue,
            });
        }
    }
    return applied;
}
