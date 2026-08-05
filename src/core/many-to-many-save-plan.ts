import type { ModificationSqlBuilder } from '../sql/modification-sql-builder';
import { EntityState } from '../tracking/entity-state';
import type { ManyToManyChange } from './many-to-many-change';
import type { ManyToManyChangeValidator } from './many-to-many-change-validator';
import {
    buildManyToManyPairs,
    captureManyToManyChanges,
    type CapturedManyToManyChange,
    coalesceManyToManyChanges,
} from './many-to-many-key-pairs';
import type { SavePlanEntry } from './save-plan';
import type { PersistedEntrySnapshot } from '../tracking/persisted-entry-snapshot';
import type { SqlStatement } from '../sql/sql-statement';
import {
    registerSavePlanExecution,
    type PersistedValueLookup,
} from './save-plan-execution';

export function buildManyToManySavePlan(
    changes: readonly ManyToManyChange[],
    validator: ManyToManyChangeValidator,
    sql: ModificationSqlBuilder,
    snapshotsByEntity: ReadonlyMap<object, PersistedEntrySnapshot>,
): SavePlanEntry[] {
    const groups: Map<string, CapturedManyToManyChange[]> = new Map();
    const capturedChanges = captureManyToManyChanges(
        changes,
        validator,
        snapshotsByEntity,
    );

    for (const captured of coalesceManyToManyChanges(capturedChanges)) {
        const { change } = captured;
        const key = [
            change.action,
            change.sourceMetadata.entityName,
            String(change.relationship.navigationProperty),
            change.relationship.joinSchemaName ?? '',
            change.relationship.joinTableName,
            change.relationship.sourceForeignKeyColumn,
            change.relationship.targetForeignKeyColumn,
        ].join(':');
        const group = groups.get(key) ?? [];
        group.push(captured);
        groups.set(key, group);
    }

    return Array.from(groups.values()).map(group =>
        buildGroupSavePlan(group, sql),
    );
}

function buildGroupSavePlan(
    group: readonly CapturedManyToManyChange[],
    sql: ModificationSqlBuilder,
): SavePlanEntry {
    const firstCaptured = group.at(0);
    if (!firstCaptured) {
        throw new Error('Many-to-many save group cannot be empty.');
    }
    const { change: first } = firstCaptured;
    const pairs = buildManyToManyPairs(group);
    const keyValue = pairs.length === 1
        ? `${String(pairs[0][0])}->${String(pairs[0][1])}`
        : `${String(pairs.length)} changes`;

    const entry: SavePlanEntry = {
        entity: first.source,
        entityName:
      `${first.sourceMetadata.entityName}.${
          String(first.relationship.navigationProperty)
      }`,
        keyValue,
        state:
      first.action === 'link' ? EntityState.Added : EntityState.Deleted,
        statement: first.action === 'link'
            ? sql.buildInsertManyToManyBatch(first.relationship, pairs)
            : sql.buildDeleteManyToManyBatch(first.relationship, pairs),
        affectedEntityCount: group.length,
        relationshipPairs: group.map(({ change }) => ({
            source: change.source,
            target: change.target,
        })),
        ...hasDeferredEndpoint(group) ? { isDeferred: true } : {},
        skipAffectedRowsCheck: true,
        isSystemGenerated: true,
    };
    registerSavePlanExecution(entry, {
        buildStatement: persistedValue => buildGroupStatement(
            group,
            sql,
            persistedValue,
        ),
    });
    return entry;
}

function buildGroupStatement(
    group: readonly CapturedManyToManyChange[],
    sql: ModificationSqlBuilder,
    persistedValue?: PersistedValueLookup,
): SqlStatement {
    const first = group[0].change;
    const pairs = buildManyToManyPairs(group, persistedValue);
    return first.action === 'link'
        ? sql.buildInsertManyToManyBatch(first.relationship, pairs)
        : sql.buildDeleteManyToManyBatch(first.relationship, pairs);
}

function hasDeferredEndpoint(
    group: readonly CapturedManyToManyChange[],
): boolean {
    return group.some(({ source, target }) =>
        source.generatedOnAddPropertyNames.size > 0 ||
        target.generatedOnAddPropertyNames.size > 0);
}
