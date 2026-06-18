import type { SqlStatement } from './sql-statement';

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
        ? safelyFormatSensitiveValue(value)
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

function safelyFormatSensitiveValue(value: unknown): string {
    try {
        return formatSensitiveValue(value, new Set(), 0);
    } catch {
        return '[Unformattable]';
    }
}

function formatSensitiveValue(
    value: unknown,
    ancestors: Set<object>,
    depth: number,
): string {
    if (value === null || value === undefined) {
        return String(value);
    }
    if (typeof value === 'string') {
        return JSON.stringify(truncate(value, 160));
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    if (typeof value === 'bigint') {
        return `${String(value)}n`;
    }
    if (typeof value === 'symbol') {
        return `[Symbol ${truncate(value.description ?? '', 80)}]`;
    }
    if (typeof value === 'function') {
        return `[Function ${truncate(value.name || 'anonymous', 80)}]`;
    }
    if (value instanceof Date) {
        const time = value.getTime();
        return Number.isNaN(time) ? 'Date(Invalid)' : `Date(${JSON.stringify(value.toISOString())})`;
    }
    if (value instanceof Uint8Array) {
        const preview = Array.from(value.slice(0, 32), byte =>
            byte.toString(16).padStart(2, '0')).join('');
        return `Uint8Array(length=${String(value.length)}, hex=${preview}${value.length > 32 ? '…' : ''})`;
    }
    if (ancestors.has(value)) {
        return '[Circular]';
    }
    if (depth >= 4) {
        return '[Object]';
    }

    ancestors.add(value);
    try {
        if (Array.isArray(value)) {
            return `[${value.slice(0, 20).map(item =>
                formatSensitiveValue(item, ancestors, depth + 1)).join(', ')}${value.length > 20 ? ', …' : ''}]`;
        }
        const descriptors = Object.getOwnPropertyDescriptors(value);
        const entries = Reflect.ownKeys(descriptors).slice(0, 20).map(key => {
            const descriptor = descriptors[key as keyof typeof descriptors];
            const label = typeof key === 'symbol'
                ? `[${String(key)}]`
                : JSON.stringify(key);
            const rendered = 'value' in descriptor
                ? formatSensitiveValue(descriptor.value, ancestors, depth + 1)
                : '[Accessor]';
            return `${label}: ${rendered}`;
        });
        const omitted = Reflect.ownKeys(descriptors).length > 20 ? ', …' : '';
        return `{${entries.join(', ')}${omitted}}`;
    } finally {
        ancestors.delete(value);
    }
}

function truncate(value: string, length: number): string {
    return value.length <= length
        ? value
        : `${value.slice(0, length)}…(+${String(value.length - length)} chars)`;
}
