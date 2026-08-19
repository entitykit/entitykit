import type { SqlDialect } from '../../sql/sql-dialect';

/** Maximum complete rows that fit within one provider statement. */
export function maxParameterBatchSize(
    dialect: SqlDialect,
    parametersPerRow: number,
): number {
    const limit = dialect.maxStatementParameters?.();
    if (limit === undefined) {
        return Number.POSITIVE_INFINITY;
    }

    return Math.max(
        Math.floor(limit / Math.max(parametersPerRow, 1)),
        1,
    );
}
