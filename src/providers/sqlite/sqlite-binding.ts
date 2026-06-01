/**
 * Inbound value binding for the SQLite adapter.
 *
 * SQLite's storage classes are far narrower than JavaScript's value space, so
 * every bound parameter must first be reduced to one of the shapes
 * `node:sqlite` accepts (null, number, bigint, string, Uint8Array). Keeping this
 * translation in one module leaves the statement-execution core free of type
 * coercion and mirrors `sqliteValueReader`, which reverses the mapping on read.
 */

export type SqliteBindValue = null | number | bigint | string | Uint8Array;

/**
 * Reduce a JavaScript value to a form `node:sqlite` can bind, applying the same
 * conventions `sqliteValueReader` relies on when reading rows back (booleans as
 * 0/1, dates as ISO strings, objects as JSON text).
 */
export function toBindValue(value: unknown): SqliteBindValue {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value === 'boolean') {
        return value ? 1 : 0;
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' || value instanceof Uint8Array) {
        return value;
    }
    if (typeof value === 'object') {
    // SQLite has no JSON storage class; text is what `json`/`jsonb` columns
    // hold, and `sqliteValueReader` parses it back on read.
        return JSON.stringify(value);
    }

    // Let SQLite reject anything else, surfaced as a provider error.
    return value as SqliteBindValue;
}
