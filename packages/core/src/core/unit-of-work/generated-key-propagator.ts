import type { SavePlanEntry } from '../save-plan';
import type { SaveTimeMutationLog } from '../save-time-mutations';
import type { GeneratedKeyPropagation } from '../save-plan-execution';
import type { AppliedPropertyValue } from './applied-generated-value';
import { isGeneratedOnAdd } from '../../model/value-generated';
import { snapshotPropertyValuesEqual } from '../../tracking/snapshot-value';
import {
    fromProviderValue,
    toBoundProviderValue,
} from '../../model/value-converter/store-value';
import { cloneSnapshotValue } from '../../tracking/snapshot-value-clone';
import {
    readPropertyValue,
} from '../../model/property-value-access';
import type { ChangeTracker } from '../../tracking/change-tracker';
import { generatedRelationshipTargetWasRestored } from '../../tracking/generated-relationship-target-provenance';
import type { PreparedGeneratedValue } from './prepared-generated-value';
import { applyPreparedGeneratedValue } from './generated-value-writer';
import type { RestorationScope } from '../../restoration-scope';

/** Copy hydrated principal keys into empty foreign keys before dependent SQL. */
export function propagateGeneratedKeys(
    changeTracker: ChangeTracker,
    entry: SavePlanEntry,
    persistedValues: Record<string, unknown>,
    persistedBoundValues: Record<string, unknown>,
    mutations: SaveTimeMutationLog,
    scope: RestorationScope,
    propagations: readonly GeneratedKeyPropagation[] = [],
    findGeneratedValue: (
        principal: object,
        propertyName: string,
    ) => AppliedPropertyValue | undefined,
    registerPrepared: (
        value: PreparedGeneratedValue,
    ) => void = () => undefined,
): readonly AppliedPropertyValue[] {
    const applied: AppliedPropertyValue[] = [];
    for (const propagation of propagations) {
        const dependent = changeTracker.entry(entry.entity);
        const principal = changeTracker.entry(propagation.principal);
        const restored: boolean[] = [];
        mutations.recordRestoration(() => {
            if (!dependent || !principal) return;
            generatedRelationshipTargetWasRestored(
                dependent,
                propagation.relationship,
                principal,
                propagation.restoredForeignKeyBoundValues,
                restored.length > 0 && restored.every(Boolean),
            );
        });
        for (const property of propagation.properties) {
            const restorationIndex = restored.push(false) - 1;
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
            const sourceBoundValue = generated?.boundValue ??
                property.principalBoundValue;
            const boundValue = cloneSnapshotValue(toBoundProviderValue(
                sourceBoundValue,
                foreignKey.columnType,
                context,
            ));
            const persistedValue = fromProviderValue(
                cloneSnapshotValue(boundValue),
                foreignKey.converter,
                context,
            );
            const liveValue = fromProviderValue(
                cloneSnapshotValue(boundValue),
                foreignKey.converter,
                context,
            );
            const prepared: PreparedGeneratedValue = Object.freeze({
                property: foreignKey,
                propertyName: property.foreignKeyProperty,
                persistedValue,
                boundValue,
                liveValue,
                context,
            });
            registerPrepared(prepared);
            const previousLiveValue = readPropertyValue(entry.entity, foreignKey);
            if (snapshotPropertyValuesEqual(
                previousLiveValue,
                property.foreignKeyValue,
                foreignKey.converter,
                context,
            )) {
                applyPreparedGeneratedValue(
                    entry.entity,
                    prepared,
                    mutations,
                    scope,
                    propagation.dependentMetadata,
                    wasRestored => {
                        restored[restorationIndex] = wasRestored;
                    },
                );
            }
            persistedValues[property.foreignKeyProperty] = persistedValue;
            persistedBoundValues[property.foreignKeyProperty] = boundValue;
            applied.push(prepared);
        }
    }
    return applied;
}
