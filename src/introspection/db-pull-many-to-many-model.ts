import type { DatabaseForeignKey, DatabaseTable } from './database-schema';
import type { EntityShape, ManyToManyJoinShape } from './db-pull-codegen-types';
import {
    createNavigationNameUsage,
    foreignKeyTargetsPrimaryKey,
    makeUniqueNavigationName,
    tableKey,
} from './db-pull-emit-helpers';
import { classifyJoinTable } from './db-pull-many-to-many-candidate';

export function detectManyToManyJoinTables(
    tables: readonly DatabaseTable[],
    entityByTable: ReadonlyMap<string, EntityShape>,
): ManyToManyJoinShape[] {
    const joins: ManyToManyJoinShape[] = [];
    const usedNames = new Map(Array.from(entityByTable.values()).map(
        entity => [entity, createNavigationNameUsage(entity)],
    ));

    for (const table of tables) {
        const classification = classifyJoinTable(table);
        if (classification.kind !== 'pure') {
            continue;
        }
        const foreignKeys = classification.foreignKeys;

        const source = findPrincipal(entityByTable, foreignKeys[0]);
        const target = findPrincipal(entityByTable, foreignKeys[1]);
        if (!source || !target) {
            continue;
        }
        if (
            !foreignKeyTargetsPrimaryKey(foreignKeys[0], source) ||
      !foreignKeyTargetsPrimaryKey(foreignKeys[1], target)
        ) {
            continue;
        }
        const sourceNames = usedNames.get(source);
        const targetNames = usedNames.get(target);
        if (!sourceNames || !targetNames) {
            throw new Error(
                'Many-to-many navigation name state was not initialized.',
            );
        }

        joins.push({
            joinTable: table,
            source,
            target,
            sourceForeignKey: foreignKeys[0],
            targetForeignKey: foreignKeys[1],
            sourceNavigationName: makeUniqueNavigationName(
                target.setName,
                sourceNames,
            ),
            targetNavigationName: makeUniqueNavigationName(
                source.setName,
                targetNames,
            ),
        });
    }
    return joins;
}

export function isReviewRequiredJoinEntity(
    table: DatabaseTable,
    entityByTable: ReadonlyMap<string, EntityShape>,
): boolean {
    const classification = classifyJoinTable(table);
    if (classification.kind === 'notJoin') {
        return false;
    }
    if (table.foreignKeys.some(foreignKey =>
        !findPrincipal(entityByTable, foreignKey))) {
        return false;
    }
    if (table.foreignKeys.some(foreignKey => {
        const principal = findPrincipal(entityByTable, foreignKey);
        return principal && !foreignKeyTargetsPrimaryKey(foreignKey, principal);
    })) {
        return true;
    }
    return classification.kind === 'review';
}

function findPrincipal(
    entityByTable: ReadonlyMap<string, EntityShape>,
    foreignKey: DatabaseForeignKey,
): EntityShape | undefined {
    return entityByTable.get(tableKey(
        foreignKey.principalSchemaName,
        foreignKey.principalTableName,
    ));
}
