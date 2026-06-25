import type { ModelSnapshot } from '../model/model-snapshot-types';
import { toColumnDefinition } from './model-diff-helpers';
import type { ModelDiffOperation } from './model-diff-operations';
import { cloneModelSnapshot } from './model-snapshot-clone';
import { renameSnapshotProperty } from './model-snapshot-property-rename';

/** Public contract for model diff rename hints. */ export interface ModelDiffRenameHints {
    /** The tables. */ readonly tables?: ReadonlyArray<{
        /** The from. */ readonly from: string;
        /** The to. */ readonly to: string;
        /** The schema name. */ readonly schemaName?: string;
    }>;
    /** The columns. */ readonly columns?: ReadonlyArray<{
        /** The table name. */ readonly tableName: string;
        /** The from. */ readonly from: string;
        /** The to. */ readonly to: string;
        /** The schema name. */ readonly schemaName?: string;
    }>;
}

/** Normalize a prior snapshot through explicit table and column rename hints. */
export function applyRenameHints(
    from: ModelSnapshot,
    to: ModelSnapshot,
    hints: ModelDiffRenameHints | undefined,
): {
    readonly snapshot: ModelSnapshot;
    readonly renameOperations: readonly ModelDiffOperation[];
} {
    if (!hints?.tables?.length && !hints?.columns?.length) {
        return { snapshot: from, renameOperations: [] };
    }

    let snapshot = cloneModelSnapshot(from);
    const renameOperations: ModelDiffOperation[] = [];

    for (const hint of hints.tables ?? []) {
        const entity = snapshot.entities.find(
            item => item.tableName === hint.from && item.schemaName === hint.schemaName,
        );
        const targetEntity = to.entities.find(
            item => item.tableName === hint.to && item.schemaName === hint.schemaName,
        );
        if (!entity || !targetEntity) {
            continue;
        }

        renameOperations.push({
            kind: 'renameTable',
            entityName: targetEntity.entityName,
            tableName: hint.from,
            newTableName: hint.to,
            schemaName: hint.schemaName,
        });

        snapshot = {
            ...snapshot,
            entities: snapshot.entities.map(item => {
                const renamed = item === entity
                    ? {
                        ...item,
                        entityName: targetEntity.entityName,
                        tableName: hint.to,
                    }
                    : item;
                return {
                    ...renamed,
                    relationships: renamed.relationships.map(relationship =>
                        relationship.principalEntityName === entity.entityName
                            ? {
                                ...relationship,
                                principalEntityName: targetEntity.entityName,
                            }
                            : relationship),
                    manyToManyRelationships:
                        renamed.manyToManyRelationships?.map(relationship =>
                            relationship.targetEntityName === entity.entityName
                                ? {
                                    ...relationship,
                                    targetEntityName: targetEntity.entityName,
                                }
                                : relationship),
                };
            }),
        };
    }

    for (const hint of hints.columns ?? []) {
        const entity = snapshot.entities.find(
            item => item.tableName === hint.tableName && item.schemaName === hint.schemaName,
        );
        if (!entity) {
            continue;
        }

        const property = entity.properties.find(
            item => item.columnName === hint.from,
        );
        const targetEntity = to.entities.find(
            item => item.tableName === hint.tableName && item.schemaName === hint.schemaName,
        );
        const targetProperty = targetEntity?.properties.find(
            item => item.columnName === hint.to,
        );
        if (!property || !targetProperty) {
            continue;
        }

        const previousColumn = toColumnDefinition(property);
        renameOperations.push({
            kind: 'alterColumn',
            entityName: entity.entityName,
            tableName: entity.tableName,
            schemaName: entity.schemaName,
            column: {
                ...previousColumn,
                name: hint.to,
                oldName: hint.from,
                oldType: previousColumn.type,
                oldNullable: previousColumn.nullable,
                oldDefaultSql: previousColumn.defaultSql,
                oldComputedSql: previousColumn.computedSql,
                oldComputedStored: previousColumn.computedStored,
                oldCollation: previousColumn.collation,
                oldStoreGeneration: previousColumn.storeGeneration,
            },
        });

        snapshot = renameSnapshotProperty(
            snapshot,
            entity,
            property,
            targetProperty,
        );
    }

    return { snapshot, renameOperations };
}
