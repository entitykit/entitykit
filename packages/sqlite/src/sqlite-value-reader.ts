import type { StoreValueReader } from '@entitykit/core/adapter';

/**
 * SQLite stores every value as one of five storage classes, and `node:sqlite`
 * returns exactly what is stored: a boolean comes back as `0`/`1`, a timestamp
 * as the text it was written as. The driver has no column-type information to
 * do better, so the provider restores the JavaScript value from the *mapped*
 * column type instead.
 *
 * Column types are matched by family (`bool`, `timestamptz`, `datetime`, ...)
 * because EntityKit passes mapped column types through to DDL verbatim, and
 * SQLite accepts any type name. Unrecognized types are returned unchanged.
 */

function isBooleanType(columnType: string): boolean {
    return columnType.startsWith('bool');
}

function isDateType(columnType: string): boolean {
    // Only instants convert. `date` is a calendar day and `time`/`timetz` are
    // clock values; neither is a point in time, and turning them into `Date`
    // forces a timezone choice this layer cannot make correctly. Map them with
    // `dateOnlyAsString()` / `dateOnlyAsUtcDate()` instead.
    return columnType.startsWith('timestamp') || columnType.startsWith('datetime');
}

function isJsonType(columnType: string): boolean {
    return columnType === 'json' || columnType === 'jsonb';
}

function isArrayType(columnType: string): boolean {
    // Postgres returns array columns as JavaScript arrays. SQLite has no array
    // storage class, so EntityKit writes JSON text and reads it back here.
    return columnType.endsWith('[]');
}

function toBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'bigint') {
        return value !== 0n;
    }
    if (typeof value === 'number') {
        return value !== 0;
    }
    if (typeof value === 'string') {
    // SQLite has no boolean literal, so text columns can hold either spelling.
        return value === '1' || value.toLowerCase() === 'true';
    }

    return Boolean(value);
}

function toDate(value: unknown): unknown {
    if (value instanceof Date) {
        return value;
    }
    if (typeof value === 'number') {
        return new Date(value);
    }
    if (typeof value === 'bigint') {
        return new Date(Number(value));
    }
    if (typeof value === 'string') {
        const parsed = new Date(value);
        // Leave unparseable text alone rather than materializing an Invalid Date.
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
    // Not every json-typed column holds EntityKit-written JSON; keep the text.
        return value;
    }
}

/** Built-in sqlite value reader. */ export const sqliteValueReader: StoreValueReader = Object.freeze({
    readValue(value: unknown, columnType: string): unknown {
        const normalized = columnType.trim().toLowerCase();

        if (isBooleanType(normalized)) {
            return toBoolean(value);
        }
        if (isDateType(normalized)) {
            return toDate(value);
        }
        if (isJsonType(normalized) || isArrayType(normalized)) {
            return toJson(value);
        }

        return value;
    },
});
