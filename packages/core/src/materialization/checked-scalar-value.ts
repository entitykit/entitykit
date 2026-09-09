/** Check the normalized JavaScript representation of an unconverted SQL scalar. */
export function isCheckedScalarValue(value: unknown, columnType: string): boolean | undefined {
    const type = columnType.trim().toLowerCase().replace(/\s+/gu, ' ');
    if (/^(?:text|uuid|(?:var)?char(?:acter)?(?: varying)?(?:\(\d+\))?)$/u.test(type)) {
        return typeof value === 'string';
    }
    if (/^(?:smallint|integer|int|int2|int4|serial|smallserial)$/u.test(type)) {
        return typeof value === 'number' && Number.isSafeInteger(value);
    }
    if (/^(?:real|double precision|double|float|float4|float8)$/u.test(type)) {
        return typeof value === 'number' && Number.isFinite(value);
    }
    if (/^(?:bool|boolean)$/u.test(type)) {
        return typeof value === 'boolean';
    }
    if (/^(?:timestamp(?:\(\d+\))?(?: with(?:out)? time zone)?|timestamptz|datetime(?:\(\d+\))?)$/u.test(type)) {
        return value instanceof Date && Number.isFinite(value.getTime());
    }
    if (/^(?:bytea|blob|(?:var)?binary(?:\(\d+\))?)$/u.test(type)) {
        return value instanceof Uint8Array;
    }
    // Bigint, decimal, date-only, JSON, arrays, and custom SQL types have no
    // single portable model representation. Their callers supply a guard.
    return undefined;
}
