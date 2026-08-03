import type { ModificationSqlBuilder } from '../../sql/modification-sql-builder';
import type { SqlDialect } from '../../sql/sql-dialect';
import type { SqlStatement } from '../../sql/sql-statement';
import type { EntityEntry } from '../../tracking/entity-entry';
import { EntityState } from '../../tracking/entity-state';
import type { SavePlanEntry } from '../save-plan';
import { buildInsertSavePlanEntry, maxInsertBatchSize } from './insert-plan';
import { isGeneratedOnAdd } from '../../model/value-generated';
import {
    type GeneratedKeyPropagation,
    generatedValuesForUpdate,
    registerSavePlanExecution,
} from '../save-plan-execution';
import { relationshipPrincipalKeyProperties } from '../../model/relationship-key';
import { assertNoKeyModifications } from './immutable-key-change';
import { capturePersistedEntrySnapshot } from '../../tracking/persisted-entry-snapshot';

export function buildEntitySavePlan(
    sql: ModificationSqlBuilder,
    dialect: SqlDialect,
    pending: ReadonlyArray<EntityEntry<object>>,
): SavePlanEntry[] {
    const plan: SavePlanEntry[] = [];
    let insertGroup: Array<EntityEntry<object>> = [];
    const entriesByEntity = new Map(pending.map(entry => [entry.entity, entry]));

    const flushInsertGroup = (): void => {
        if (insertGroup.length === 0) {
            return;
        }

        const first = insertGroup[0];
        plan.push(buildInsertSavePlanEntry(
            sql,
            insertGroup,
            generatedKeyPropagations(first, entriesByEntity),
        ));
        insertGroup = [];
    };

    for (const entry of pending) {
        const propagations = generatedKeyPropagations(entry, entriesByEntity);
        if (
            entry.state === EntityState.Added &&
            propagations === undefined &&
            insertGroup.length > 0 &&
            generatedKeyPropagations(insertGroup[0], entriesByEntity) === undefined &&
            insertGroup[0]?.metadata === entry.metadata &&
            insertGroup.length < maxInsertBatchSize(dialect, entry.metadata)
        ) {
            insertGroup.push(entry);
            continue;
        }

        flushInsertGroup();

        if (entry.state === EntityState.Added) {
            insertGroup.push(entry);
            continue;
        }

        const statement = buildSaveStatement(sql, entry);
        if (statement) {
            const planEntry: SavePlanEntry = {
                entity: entry.entity,
                entityName: entry.metadata.entityName,
                keyValue: entry.keyValue,
                state: entry.state,
                statement,
            };
            registerSavePlanExecution(planEntry, {
                metadata: entry.metadata,
                generatedValues: generatedValuesForUpdate(entry),
                persistedEntries: [capturePersistedEntrySnapshot(entry)],
            });
            plan.push(planEntry);
        }
    }

    flushInsertGroup();
    return plan;
}

function generatedKeyPropagations(
    dependent: EntityEntry<object>,
    entriesByEntity: ReadonlyMap<object, EntityEntry<object>>,
): readonly GeneratedKeyPropagation[] | undefined {
    if (dependent.state !== EntityState.Added) {
        return undefined;
    }

    const values = dependent.entity as Record<string, unknown>;
    const propagations = dependent.metadata.relationships.flatMap(relationship => {
        const principal = entriesByEntity.get(values[relationship.navigationProperty] as object);
        const principalKeyProperties = principal
            ? relationshipPrincipalKeyProperties(
                relationship,
                principal.metadata,
            )
            : [];
        if (
            principal?.state !== EntityState.Added ||
            !principalKeyProperties.some(propertyName =>
                isGeneratedOnAdd(
                    principal.metadata.getProperty(propertyName).valueGenerated,
                )) ||
            !relationship.foreignKeyProperties.some(propertyName =>
                isEmpty(values[propertyName]))
        ) {
            return [];
        }
        return [{
            principal: principal.entity,
            principalMetadata: principal.metadata,
            principalKeyProperties: principalKeyProperties.map(String),
            foreignKeyProperties: relationship.foreignKeyProperties.map(String),
        }];
    });
    return propagations.length > 0 ? propagations : undefined;
}

function isEmpty(value: unknown): boolean {
    return value === undefined || value === null || value === '';
}

function buildSaveStatement(
    sql: ModificationSqlBuilder,
    entry: EntityEntry<object>,
): SqlStatement | undefined {
    if (entry.state === EntityState.Added) {
        return sql.buildInsert(entry.metadata, entry.entity);
    }

    if (entry.state === EntityState.Modified) {
        const modifiedProperties = entry.modifiedProperties();
        assertNoKeyModifications(entry, modifiedProperties);
        return sql.buildUpdate(entry.metadata, entry.entity, modifiedProperties, entry.originalValues);
    }

    if (entry.state === EntityState.Deleted) {
        return sql.buildDelete(entry.metadata, entry.entity, entry.originalValues);
    }

    return undefined;
}
