import type { EntityMetadata } from '../model/entity-metadata';
import { isGeneratedOnUpdate } from '../model/value-generated';
import type { EntityEntry } from '../tracking/entity-entry';
import type { SavePlanEntry } from './save-plan';
import type { ManyToManyChange } from './many-to-many-change';
import type { PersistedEntrySnapshot } from '../tracking/persisted-entry-snapshot';

export interface GeneratedValuesPlan<TEntity extends object = object> {
    readonly metadata: EntityMetadata<TEntity>;
    readonly propertyNames: readonly string[];
    readonly operation: 'insert' | 'update';
}

export interface GeneratedKeyPropagation {
    readonly principal: object;
    readonly principalMetadata: EntityMetadata;
    readonly principalKeyProperties: readonly string[];
    readonly foreignKeyProperties: readonly string[];
}

interface SavePlanExecutionMetadata {
    readonly metadata?: EntityMetadata;
    readonly generatedValues?: GeneratedValuesPlan;
    readonly generatedKeyPropagations?: readonly GeneratedKeyPropagation[];
    readonly persistedEntries?: readonly PersistedEntrySnapshot[];
    readonly manyToManyChanges?: readonly ManyToManyChange[];
}

const executionByEntry: WeakMap<
    SavePlanEntry,
    SavePlanExecutionMetadata
> = new WeakMap();

/** Attach executor-only details without widening the public interceptor plan. */
export function registerSavePlanExecution(
    entry: SavePlanEntry,
    metadata: SavePlanExecutionMetadata,
): void {
    executionByEntry.set(entry, {
        ...executionByEntry.get(entry),
        ...metadata,
    });
}

export function savePlanExecution(
    entry: SavePlanEntry,
): SavePlanExecutionMetadata | undefined {
    return executionByEntry.get(entry);
}

export function generatedValuesForUpdate(
    entry: EntityEntry<object>,
): GeneratedValuesPlan | undefined {
    const propertyNames = entry.metadata.properties
        .filter(property => isGeneratedOnUpdate(property.valueGenerated))
        .map(property => property.propertyName);
    return propertyNames.length > 0
        ? {
            metadata: entry.metadata,
            propertyNames,
            operation: 'update',
        }
        : undefined;
}
