import type { StoreValueReader } from '@entitykit/core/adapter';

/**
 * Restore JavaScript values from what the `mysql2` driver returns.
 *
 * Keyed on the *model's* declared column type — `boolean`, `timestamptz`,
 * `jsonb` — the same canonical types the SQLite reader sees, not MySQL's DDL
 * types. `mysql2` returns a `tinyint(1)` as a number, so a boolean needs
 * converting; DATETIME comes back as a `Date` (the connection runs in UTC) and
 * JSON as a parsed object, but both are handled defensively in case a column
 * holds a raw string.
 */
function toBoolean(value: unknown): boolean {
    if (typeof value === 'string') {
        return value === '1' || value.toLowerCase() === 'true';
    }

    return Boolean(value);
}

function toDate(value: unknown): unknown {
    if (typeof value === 'number') {
        return new Date(value);
    }
    if (typeof value === 'string') {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? value : parsed;
    }

    return value;
}

function toJson(value: unknown): unknown {
    if (typeof value !== 'string') {
        return value;
    }

    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

/** Built-in my sql value reader. */ export const mySqlValueReader: StoreValueReader = Object.freeze({
    readValue(value: unknown, columnType: string): unknown {
        const normalized = columnType.trim().toLowerCase();

        if (normalized.startsWith('bool') || normalized === 'tinyint(1)') {
            return toBoolean(value);
        }
        if (normalized.startsWith('timestamp') || normalized.startsWith('datetime')) {
            return toDate(value);
        }
        if (normalized === 'json' || normalized === 'jsonb' || normalized.endsWith('[]')) {
            return toJson(value);
        }

        return value;
    },
});
