import type { SqlDialect } from '../sql/sql-dialect';
import type { SqlStatement } from '../sql/sql-statement';

/** Compile a real key to count filters, tenant bindings and window bounds. */
export function* includeKeyStatements<TKey>(
    dialect: SqlDialect,
    keys: readonly TKey[],
    columnsPerKey: number,
    build: (keys: readonly TKey[]) => SqlStatement,
): Generator<SqlStatement> {
    if (keys.length === 0) return;
    const limit = dialect.maxStatementParameters?.();
    const sample = limit === undefined ? undefined : build(keys.slice(0, 1));
    const reserved = sample ? sample.values.length - columnsPerKey : 0;
    // A portable bound also protects providers' expression parsers, independent
    // of their much larger wire parameter capacity.
    const size = Math.min(keys.length, columnsPerKey > 1 ? 256 : Number.POSITIVE_INFINITY,
        limit === undefined ? Number.POSITIVE_INFINITY : Math.floor((limit - reserved) / columnsPerKey));
    if (size < 1) throw new Error('Include filters and window bounds leave no room for a parent key.');
    for (let start = 0; start < keys.length; start += size) {
        const chunk = keys.slice(start, start + size);
        yield start === 0 && chunk.length === 1 && sample ? sample : build(chunk);
    }
}
