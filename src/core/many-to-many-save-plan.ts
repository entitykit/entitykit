import type { ModificationSqlBuilder } from '../sql/modification-sql-builder';
import { EntityState } from '../tracking/entity-state';
import type { ManyToManyChange } from './many-to-many-change';
import type { ManyToManyChangeValidator } from './many-to-many-change-validator';
import {
    buildValidatedManyToManyPairs,
    coalesceManyToManyChanges,
} from './many-to-many-key-pairs';
import type { SavePlanEntry } from './save-plan';

export function buildManyToManySavePlan(
    changes: readonly ManyToManyChange[],
    validator: ManyToManyChangeValidator,
    sql: ModificationSqlBuilder,
): SavePlanEntry[] {
    const groups: Map<string, ManyToManyChange[]> = new Map();

    for (const change of coalesceManyToManyChanges(changes, validator)) {
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
        group.push(change);
        groups.set(key, group);
    }

    return Array.from(groups.values()).map(group =>
        buildGroupSavePlan(group, validator, sql),
    );
}

function buildGroupSavePlan(
    group: readonly ManyToManyChange[],
    validator: ManyToManyChangeValidator,
    sql: ModificationSqlBuilder,
): SavePlanEntry {
    const first = group.at(0);
    if (!first) {
        throw new Error('Many-to-many save group cannot be empty.');
    }
    const pairs = buildValidatedManyToManyPairs(group, validator);
    const keyValue = pairs.length === 1
        ? `${String(pairs[0][0])}->${String(pairs[0][1])}`
        : `${String(pairs.length)} changes`;

    return {
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
        skipAffectedRowsCheck: true,
        isSystemGenerated: true,
    };
}
