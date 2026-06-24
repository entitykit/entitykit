import type { EntityMetadata } from '../../model/entity-metadata';
import type { ModificationSqlBuilder } from '../../sql/modification-sql-builder';
import type { SqlDialect } from '../../sql/sql-dialect';
import type { EntityEntry } from '../../tracking/entity-entry';
import { EntityState } from '../../tracking/entity-state';
import type { SavePlanEntry } from '../save-plan';
import { isGeneratedOnAdd } from '../../model/value-generated';
import {
    type GeneratedKeyPropagation,
    type GeneratedValuesPlan,
    registerSavePlanExecution,
} from '../save-plan-execution';

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
    const limit = dialect.maxStatementParameters?.();
    if (limit === undefined) {
        return Number.POSITIVE_INFINITY;
    }

    const parametersPerRow = Math.max(
        metadata.properties.filter(property =>
            !isGeneratedOnAdd(property.valueGenerated)).length,
        1,
    );
    return Math.max(Math.floor(limit / parametersPerRow), 1);
}

/** Build one save-plan entry from a non-empty group of compatible inserts. */
export function buildInsertSavePlanEntry(
    sql: ModificationSqlBuilder,
    entries: ReadonlyArray<EntityEntry<object>>,
    generatedKeyPropagations?: readonly GeneratedKeyPropagation[],
): SavePlanEntry {
    if (entries.length === 0) {
        throw new Error('Insert save-plan group cannot be empty.');
    }

    if (entries.length === 1) {
        const entry = entries[0];
        const planEntry: SavePlanEntry = {
            entity: entry.entity,
            entityName: entry.metadata.entityName,
            keyValue: entry.keyValue,
            state: entry.state,
            statement: sql.buildInsert(
                entry.metadata,
                entry.entity,
                generatedKeyPropagations?.flatMap(
                    propagation => propagation.foreignKeyProperties,
                ),
            ),
        };
        registerSavePlanExecution(planEntry, {
            metadata: entry.metadata,
            generatedValues: generatedValuesForInsert(entry.metadata),
            generatedKeyPropagations,
        });
        return planEntry;
    }

    const first = entries[0];
    return {
        entity: first.entity,
        entityName: first.metadata.entityName,
        keyValue: `${String(entries.length)} entities`,
        state: EntityState.Added,
        statement: sql.buildInsertBatch(first.metadata, entries.map(entry => entry.entity)),
        affectedEntityCount: entries.length,
        expectedAffectedRows: entries.length,
    };
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
