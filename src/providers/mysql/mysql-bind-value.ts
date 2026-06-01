/**
 * Serialize a bound value the way MySQL expects.
 *
 * `mysql2` does not stringify a plain object, so a `json` column would receive
 * `[object Object]` and be rejected as invalid JSON. Objects and arrays become
 * JSON text here, exactly as the SQLite connection does; dates and buffers are
 * left for the driver, which handles them with the connection's UTC timezone.
 */
export function toMysqlBindValue(value: unknown): unknown {
    if (value === null || value === undefined) {
        return value;
    }
    if (value instanceof Date || value instanceof Uint8Array) {
        return value;
    }
    if (typeof value === 'object') {
        return JSON.stringify(value);
    }
    return value;
}
