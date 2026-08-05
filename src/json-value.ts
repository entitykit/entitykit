import { isPromiseLike } from './promise-like';

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
    return normalize(value, path, new Set());
}

/** Validate, snapshot, and serialize an exact JSON value once. */
export function serializeJsonValue(value: unknown, path = 'JSON value'): string {
    return JSON.stringify(normalizeJsonValue(value, path));
}

function normalize(
    value: unknown,
    path: string,
    ancestors: Set<object>,
): JsonValue {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw unsupportedJson(path, String(value));
        }
        return value;
    }
    if (isPromiseLike(value)) {
        void Promise.resolve(value).catch(() => undefined);
        throw unsupportedJson(path, 'Promise or thenable');
    }
    if (Array.isArray(value)) {
        return withAncestor(value, path, ancestors, () =>
            Array.from({ length: value.length }, (_unused, index) => {
                if (!Object.prototype.hasOwnProperty.call(value, index)) {
                    throw unsupportedJson(`${path}[${String(index)}]`, 'missing array element');
                }
                return normalize(value[index], `${path}[${String(index)}]`, ancestors);
            }),
        );
    }
    if (typeof value === 'object') {
        const prototype: unknown = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            throw unsupportedJson(path, value.constructor.name || 'object');
        }
        if (Object.getOwnPropertySymbols(value).length > 0) {
            throw unsupportedJson(path, 'symbol-keyed property');
        }
        return withAncestor(value, path, ancestors, () =>
            Object.fromEntries(Object.entries(value).map(([key, item]) => [
                key,
                normalize(item, childPath(path, key), ancestors),
            ])),
        );
    }
    throw unsupportedJson(path, typeof value);
}

function withAncestor<TResult>(
    value: object,
    path: string,
    ancestors: Set<object>,
    work: () => TResult,
): TResult {
    if (ancestors.has(value)) {
        throw unsupportedJson(path, 'cyclic reference');
    }
    ancestors.add(value);
    try {
        return work();
    } finally {
        ancestors.delete(value);
    }
}

function childPath(path: string, key: string): string {
    return /^[A-Za-z_$][\w$]*$/.test(key)
        ? `${path}.${key}`
        : `${path}[${JSON.stringify(key)}]`;
}

function unsupportedJson(path: string, actual: string): TypeError {
    return new TypeError(
        `Unsupported JSON value at '${path}' (${actual}). ` +
        'JSON properties must contain synchronous JSON-compatible values.',
    );
}
