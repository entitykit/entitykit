import {
    EntityNotFoundError,
    MultipleEntitiesFoundError,
} from '../errors/query-errors';

export type QueryResultOperation = 'projection' | 'query' | 'raw SQL query';

/** Read the first materialized result, or null when the result set is empty. */
export function firstResultOrNull<TResult>(
    rows: readonly TResult[],
): TResult | null {
    return rows[0] ?? null;
}

/** Require a materialized result while preserving EntityKit's typed error. */
export function requireQueryResult<TResult>(
    result: TResult | null,
    entityName: string,
    operation: QueryResultOperation = 'query',
): TResult {
    if (result === null) {
        throw new EntityNotFoundError(entityName, operation);
    }
    return result;
}

/** Read at most one materialized result, rejecting an ambiguous result set. */
export function singleResultOrNull<TResult>(
    rows: readonly TResult[],
    entityName: string,
    operation: QueryResultOperation = 'query',
): TResult | null {
    if (rows.length > 1) {
        throw new MultipleEntitiesFoundError(entityName, operation);
    }
    return firstResultOrNull(rows);
}
