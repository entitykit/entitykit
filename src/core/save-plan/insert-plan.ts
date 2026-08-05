import type { EntityMetadata } from '../../model/entity-metadata';
import type { ModificationSqlBuilder } from '../../sql/modification-sql-builder';
import type { SqlDialect } from '../../sql/sql-dialect';
import type { PersistedEntrySnapshot } from '../../tracking/persisted-entry-snapshot';
import { persistedEntryKeyValue } from '../../tracking/persisted-entry-snapshot';
import { EntityState } from '../../tracking/entity-state';
import type { SavePlanEntry } from '../save-plan';
import { isGeneratedOnAdd } from '../../model/value-generated';
import {
    type GeneratedKeyPropagation,
    type GeneratedValuesPlan,
    registerSavePlanExecution,
} from '../save-plan-execution';
import { maxParameterBatchSize } from './parameter-batch-size';
import { validateRequiredComplexPropertyValues } from '../../sql/required-complex-property-validation';

/** Maximum rows that fit in one provider-legal multi-row insert statement. */
export function maxInsertBatchSize(
    dialect: SqlDialect,
    metadata: EntityMetadata,
): number {
    if (metadata.properties.some(property =>
        isGeneratedOnAdd(property.valueGenerated))) {
        // Generated rows are intentionally single-row until every provider can
        // correlate returned values to input rows without relying on row order.
        return 1;
    }
    const parametersPerRow = Math.max(
        metadata.properties.filter(property =>
            !isGeneratedOnAdd(property.valueGenerated)).length,
        1,
    );
    return maxParameterBatchSize(dialect, parametersPerRow);
}

/** Build one save-plan entry from a non-empty group of compatible inserts. */
export function buildInsertSavePlanEntry(
    sql: ModificationSqlBuilder,
    entries: readonly PersistedEntrySnapshot[],
    generatedKeyPropagations?: readonly GeneratedKeyPropagation[],
): SavePlanEntry {
    if (entries.length === 0) {
        throw new Error('Insert save-plan group cannot be empty.');
    }
    for (const snapshot of entries) {
        validateRequiredComplexPropertyValues(
            snapshot.entry.metadata,
            snapshot.complexPropertyValues,
        );
    }

    if (entries.length === 1) {
        const persisted = entries[0];
        const { entry } = persisted;
        const allowMissingProperties = generatedKeyPropagations?.flatMap(
            propagation => propagation.properties.map(
                property => property.foreignKeyProperty,
            ),
        );
        const planEntry: SavePlanEntry = {
            entity: entry.entity,
            entityName: entry.metadata.entityName,
            keyValue: persistedEntryKeyValue(persisted),
            state: persisted.state,
            statement: sql.buildInsertFromValues(
                entry.metadata,
                persisted.values,
                allowMissingProperties,
            ),
        };
        registerSavePlanExecution(planEntry, {
            metadata: entry.metadata,
            generatedValues: generatedValuesForInsert(entry.metadata),
            generatedKeyPropagations,
            persistedEntries: [persisted],
        });
        return planEntry;
    }

    const first = entries[0];
    const planEntry: SavePlanEntry = {
        entity: first.entry.entity,
        entityName: first.entry.metadata.entityName,
        keyValue: `${String(entries.length)} entities`,
        state: EntityState.Added,
        statement: sql.buildInsertBatchFromValues(
            first.entry.metadata,
            entries.map(entry => entry.values),
        ),
        affectedEntityCount: entries.length,
        expectedAffectedRows: entries.length,
    };
    registerSavePlanExecution(planEntry, {
        persistedEntries: entries,
    });
    return planEntry;
}

function generatedValuesForInsert(
    metadata: EntityMetadata,
): GeneratedValuesPlan | undefined {
    const propertyNames = metadata.properties
        .filter(property => isGeneratedOnAdd(property.valueGenerated))
        .map(property => property.propertyName);
    return propertyNames.length > 0
        ? { metadata, propertyNames, operation: 'insert' }
        : undefined;
}
