import type { ModificationSqlBuilder } from '../../sql/modification-sql-builder';
import type { SqlDialect } from '../../sql/sql-dialect';
import type { SqlStatement } from '../../sql/sql-statement';
import type { PersistedEntrySnapshot } from '../../tracking/persisted-entry-snapshot';
import { EntityState } from '../../tracking/entity-state';
import type { SavePlanEntry } from '../save-plan';
import {
    buildInsertSavePlanEntry,
    maxInsertBatchSize,
    persistedKeyValue,
} from './insert-plan';
import { isGeneratedOnAdd } from '../../model/value-generated';
import {
    type GeneratedKeyPropagation,
    generatedValuesForUpdate,
    registerSavePlanExecution,
} from '../save-plan-execution';
import { relationshipPrincipalKeyProperties } from '../../model/relationship-key';
import { assertNoKeyModifications } from './immutable-key-change';
import { validateRequiredComplexPropertyValues } from '../../sql/required-complex-property-validation';

export function buildEntitySavePlan(
    sql: ModificationSqlBuilder,
    dialect: SqlDialect,
    pending: readonly PersistedEntrySnapshot[],
): SavePlanEntry[] {
    const plan: SavePlanEntry[] = [];
    let insertGroup: PersistedEntrySnapshot[] = [];
    const entriesByEntity = new Map(pending.map(snapshot => [
        snapshot.entry.entity,
        snapshot,
    ]));

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

    for (const snapshot of pending) {
        const propagations = generatedKeyPropagations(snapshot, entriesByEntity);
        const { entry } = snapshot;
        if (
            snapshot.state === EntityState.Added &&
            propagations === undefined &&
            insertGroup.length > 0 &&
            generatedKeyPropagations(insertGroup[0], entriesByEntity) === undefined &&
            insertGroup[0]?.entry.metadata === entry.metadata &&
            insertGroup.length < maxInsertBatchSize(dialect, entry.metadata)
        ) {
            insertGroup.push(snapshot);
            continue;
        }

        flushInsertGroup();

        if (snapshot.state === EntityState.Added) {
            insertGroup.push(snapshot);
            continue;
        }

        const statement = buildSaveStatement(sql, snapshot);
        if (statement) {
            const planEntry: SavePlanEntry = {
                entity: entry.entity,
                entityName: entry.metadata.entityName,
                keyValue: persistedKeyValue(snapshot),
                state: snapshot.state,
                statement,
            };
            registerSavePlanExecution(planEntry, {
                metadata: entry.metadata,
                generatedValues: generatedValuesForUpdate(entry),
                persistedEntries: [snapshot],
            });
            plan.push(planEntry);
        }
    }

    flushInsertGroup();
    return plan;
}

function generatedKeyPropagations(
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
                relationship,
                principal.entry.metadata,
            )
            : [];
        if (
            principal?.state !== EntityState.Added ||
            !principalKeyProperties.some(propertyName =>
                isGeneratedOnAdd(
                    principal.entry.metadata.getProperty(propertyName).valueGenerated,
                )) ||
            !relationship.foreignKeyProperties.some(propertyName =>
                isEmpty(dependent.values[propertyName]))
        ) {
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

function buildSaveStatement(
    sql: ModificationSqlBuilder,
    snapshot: PersistedEntrySnapshot,
): SqlStatement | undefined {
    const { entry } = snapshot;
    if (snapshot.state === EntityState.Added) {
        validateRequiredComplexPropertyValues(
            entry.metadata,
            snapshot.complexPropertyValues,
        );
        return sql.buildInsertFromValues(entry.metadata, snapshot.values);
    }

    if (snapshot.state === EntityState.Modified) {
        validateRequiredComplexPropertyValues(
            entry.metadata,
            snapshot.complexPropertyValues,
        );
        const modifiedProperties = entry.modifiedPropertiesFromValues(
            snapshot.values,
        );
        assertNoKeyModifications(entry, modifiedProperties);
        return sql.buildUpdateFromValues(
            entry.metadata,
            snapshot.values,
            modifiedProperties,
            entry.originalValues,
        );
    }

    if (snapshot.state === EntityState.Deleted) {
        return sql.buildDeleteFromValues(
            entry.metadata,
            snapshot.values,
            entry.originalValues,
        );
    }

    return undefined;
}
