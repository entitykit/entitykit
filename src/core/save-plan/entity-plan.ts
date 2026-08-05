import type { ModificationSqlBuilder } from '../../sql/modification-sql-builder';
import type { SqlDialect } from '../../sql/sql-dialect';
import type { PersistedEntrySnapshot } from '../../tracking/persisted-entry-snapshot';
import { EntityState } from '../../tracking/entity-state';
import type { SavePlanEntry } from '../save-plan';
import {
    buildInsertSavePlanEntry,
    maxInsertBatchSize,
    persistedKeyValue,
} from './insert-plan';
import {
    generatedValuesForUpdate,
    registerSavePlanExecution,
} from '../save-plan-execution';
import { generatedKeyPropagations } from './generated-key-propagation-plan';
import { buildSaveStatement } from './entity-save-statement';

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
