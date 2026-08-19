import type { SqlStatement } from './sql-statement';
import { formatDebugValue } from '../debug-value';

/** Controls whether SQL debug output may contain application values. */
export interface DebugSqlOptions {
    /** Include parameter values. Never enable this for production logs. */
    readonly includeSensitiveData?: boolean;
}

/** Format a statement for diagnostics without throwing on unusual values. */
export function formatDebugSql(
    statement: SqlStatement,
    options: DebugSqlOptions = {},
): string {
    const values = formatDebugSqlValues(statement.values, options);
    return `${statement.text} -- parameters: [${values.join(', ')}]`;
}

/** Produce non-throwing parameter descriptions for structured diagnostics. */
export function formatDebugSqlValues(
    values: readonly unknown[],
    options: DebugSqlOptions = {},
): readonly string[] {
    return values.map(value => options.includeSensitiveData
        ? formatDebugValue(value)
        : `<redacted:${safelyDescribeValue(value)}>`);
}

function safelyDescribeValue(value: unknown): string {
    try {
        if (value === null) {
            return 'null';
        }
        if (value instanceof Date) {
            return 'date';
        }
        if (value instanceof Uint8Array) {
            return 'bytes';
        }
        if (Array.isArray(value)) {
            return 'array';
        }
        return typeof value;
    } catch {
        return 'unknown';
    }
}
