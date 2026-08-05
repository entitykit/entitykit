import type { JsonValue } from '../json-value';

export interface JsonNormalizationState {
    readonly ancestors: Set<object>;
    readonly snapshots: WeakMap<object, JsonValue>;
    firstError?: TypeError;
}

export function createJsonNormalizationState(): JsonNormalizationState {
    return {
        ancestors: new Set(),
        snapshots: new WeakMap(),
    };
}

export function rejectJson(
    state: JsonNormalizationState,
    path: string,
    actual: string,
): void {
    state.firstError ??= new TypeError(
        `Unsupported JSON value at '${path}' (${actual}). ` +
        'JSON properties must contain synchronous JSON-compatible values.',
    );
}

export function withJsonAncestor<TResult>(
    value: object,
    state: JsonNormalizationState,
    work: () => TResult,
): TResult {
    state.ancestors.add(value);
    try {
        return work();
    } finally {
        state.ancestors.delete(value);
    }
}

export function jsonChildPropertyPath(path: string, key: PropertyKey): string {
    return typeof key === 'symbol'
        ? `${path}[${String(key)}]`
        : jsonChildPath(path, String(key));
}

export function jsonChildPath(path: string, key: string): string {
    return /^[A-Za-z_$][\w$]*$/.test(key)
        ? `${path}.${key}`
        : `${path}[${JSON.stringify(key)}]`;
}

export function isJsonArrayIndex(key: PropertyKey, length: number): boolean {
    if (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/.test(key)) {
        return false;
    }
    const index = Number(key);
    return Number.isSafeInteger(index) && index >= 0 && index < length;
}

export function defineJsonProperty(
    target: Record<string, JsonValue>,
    key: string,
    value: JsonValue,
): void {
    Object.defineProperty(target, key, {
        configurable: true, enumerable: true, value, writable: true,
    });
}
