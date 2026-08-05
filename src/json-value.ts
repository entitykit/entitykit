import { normalizeUnknownJson } from './json/normalize-json-value';

/** A scalar value with an exact JSON representation. */
export type JsonPrimitive = null | string | number | boolean;

/** A value that can be persisted as JSON without lossy coercion. */
export type JsonValue =
    | JsonPrimitive
    | readonly JsonValue[]
    | { readonly [key: string]: JsonValue };

/** Validate and snapshot an unknown value as exact JSON data. */
export function normalizeJsonValue(
    value: unknown,
    path = 'JSON value',
): JsonValue {
    return normalizeUnknownJson(value, path);
}

/** Validate, snapshot, and serialize an exact JSON value once. */
export function serializeJsonValue(value: unknown, path = 'JSON value'): string {
    return JSON.stringify(normalizeJsonValue(value, path));
}
