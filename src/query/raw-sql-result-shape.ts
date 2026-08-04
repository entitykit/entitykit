import { QueryCompilationError } from '../errors/query-errors';
import type { EntityMetadata } from '../model/entity-metadata';

export function assertTrackedRawSqlRows<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    rows: ReadonlyArray<Record<string, unknown>>,
): void {
    for (const row of rows) {
        assertTrackedRawSqlRow(metadata, row);
    }
}

export function assertTrackedRawSqlRow<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    row: Record<string, unknown>,
): void {
    if (metadata.isKeyless) {
        return;
    }
    const missingColumns = metadata.properties
        .map(property => property.columnName)
        .filter(column => !Object.prototype.hasOwnProperty.call(row, column));
    if (missingColumns.length === 0) {
        return;
    }
    throw new QueryCompilationError(
        `Tracked fromSqlUnsafe() for '${metadata.entityName}' requires every mapped column. ` +
        `Missing: ${missingColumns.map(column => `'${column}'`).join(', ')}. ` +
        'Leave the unsafe query untracked for an intentional partial row.',
        { entityName: metadata.entityName, missingColumns },
    );
}
