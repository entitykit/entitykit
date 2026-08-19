import type { UpsertSqlOptions } from '../sql/modification-sql-builder';
import type { DatabaseOperationOptions } from '../storage/database-connection';

type BulkUpsertOptions<TEntity extends object> =
    UpsertSqlOptions<TEntity> & DatabaseOperationOptions;

/** Own the option shape used by every batch in one asynchronous upsert. */
export function captureBulkUpsertOptions<TEntity extends object>(
    options: BulkUpsertOptions<TEntity>,
): BulkUpsertOptions<TEntity> {
    const conflictProperties = options.conflictProperties === undefined
        ? undefined
        : Object.freeze([...options.conflictProperties]);
    const updateProperties = options.updateProperties === undefined
        ? undefined
        : Object.freeze([...options.updateProperties]);
    return Object.freeze({
        ...options,
        conflictProperties,
        updateProperties,
    });
}
