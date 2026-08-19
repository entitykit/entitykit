import type {
    EntitySnapshot,
} from '../model/model-snapshot-types';
import type { CreateTableOperation, DropTableOperation } from './model-diff-operations';
import { toColumnDefinition } from './model-diff-helpers';

/**
 * Whole-table create and drop operation construction.
 *
 * Rename hints normalize snapshots before structural detection and live in
 * their own module.
 */

export function createTableOperation(entity: EntitySnapshot): CreateTableOperation {
    return {
        kind: 'createTable',
        entityName: entity.entityName,
        tableName: entity.tableName,
        schemaName: entity.schemaName,
        columns: entity.properties.map(toColumnDefinition),
        checkConstraints: entity.checkConstraints?.map(check => ({ ...check })),
    };
}

export function dropTableOperation(entity: EntitySnapshot): DropTableOperation {
    return {
        kind: 'dropTable',
        entityName: entity.entityName,
        tableName: entity.tableName,
        schemaName: entity.schemaName,
        columns: entity.properties.map(toColumnDefinition),
        checkConstraints: entity.checkConstraints?.map(check => ({ ...check })),
    };
}

export { applyRenameHints } from './model-diff-rename-hints';
export type { ModelDiffRenameHints } from './model-diff-rename-hints';
