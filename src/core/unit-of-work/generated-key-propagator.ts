import type { PropertyMetadata } from '../../model/property-metadata';
import type { SavePlanEntry } from '../save-plan';
import type { SaveTimeMutationLog } from '../save-time-mutations';
import type { GeneratedKeyPropagation } from '../save-plan-execution';

/** Copy hydrated principal keys into empty foreign keys before dependent SQL. */
export function propagateGeneratedKeys(
    entry: SavePlanEntry,
    mutations: SaveTimeMutationLog,
    propagations: readonly GeneratedKeyPropagation[] = [],
): void {
    const values = entry.entity as Record<string, unknown>;
    for (const propagation of propagations) {
        const principal = propagation.principal as Record<string, unknown>;
        const keyValues = propagation.principalKeyProperties.map(
            propertyName => principal[propertyName],
        );
        propagation.foreignKeyProperties.forEach((propertyName, index) => {
            if (hasValue(values, { propertyName })) {
                return;
            }
            const value = keyValues[index];
            if (value === undefined || value === null || value === '') {
                throw new Error(
                    `Cannot insert '${entry.entityName}' because the database-generated key for '${propagation.principalMetadata.entityName}' was not available.`,
                );
            }
            mutations.record(values, propertyName);
            values[propertyName] = value;
        });
    }
}

function hasValue(
    entity: object,
    property: Pick<PropertyMetadata, 'propertyName'>,
): boolean {
    const value = (entity as Record<string, unknown>)[property.propertyName];
    return value !== undefined && value !== null && value !== '';
}
