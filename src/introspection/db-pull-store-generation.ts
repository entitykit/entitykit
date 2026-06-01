import type { DatabaseColumn } from './database-schema';
import type { EntityShape } from './db-pull-codegen-types';

/** Explain store-generation shapes the model cannot reproduce as provider DDL. */
export function unsupportedStoreGeneration(
    entity: EntityShape,
    column: DatabaseColumn,
): string | undefined {
    if (column.storeGeneration?.kind === 'autoIncrement') {
        return entity.table.primaryKey?.columns[0] === column.name
            ? undefined
            : 'its auto-increment column must be the first primary-key column';
    }
    if (column.storeGeneration?.kind === 'rowid') {
        const key = entity.table.primaryKey?.columns ?? [];
        return key.length === 1 && key[0] === column.name
            ? undefined
            : 'its rowid column must be the single primary-key column';
    }
    return undefined;
}
