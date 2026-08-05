import { compareJsonKeys } from '../json/canonical-json';
import {
    consumeThenable,
    ownThenFunction,
    readInheritedThen,
} from '../json/json-object-inspection';
const serializedDefaultType = '$entitykitDefaultType';

export interface SerializedBigIntDefault {
    readonly [serializedDefaultType]: 'bigint';
    readonly value: string;
}

export function assertSupportedDefaultValue(value: unknown): void {
    normalizeDefaultValue(value, 'defaultValue', false, new Set());
}

export function serializeDefaultValue(value: unknown): unknown {
    if (isSerializedBigIntDefault(value)) {
        return { ...value };
    }
    const normalized = normalizeDefaultValue(
        value,
        'defaultValue',
        false,
        new Set(),
    );
    return typeof normalized === 'bigint'
        ? {
            [serializedDefaultType]: 'bigint',
            value: normalized.toString(),
        } satisfies SerializedBigIntDefault
        : normalized;
}

export function isSerializedBigIntDefault(
    value: unknown,
): value is SerializedBigIntDefault {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const record = value as Record<string, unknown>;
    return record[serializedDefaultType] === 'bigint' &&
    typeof record.value === 'string' &&
    /^-?\d+$/.test(record.value);
}

export function normalizeDefaultValue(
    value: unknown,
    path = 'defaultValue',
    nested = false,
    ancestors: Set<object> = new Set(),
): unknown {
    if (
        value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
    ) {
        return value;
    }

    if (value === undefined) {
        if (!nested) {
            return undefined;
        }
        throw unsupportedDefault(path, 'undefined');
    }

    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw unsupportedDefault(path, String(value));
        }
        return value;
    }

    if (typeof value === 'bigint') {
        if (nested) {
            throw unsupportedDefault(path, 'nested bigint');
        }
        return value;
    }

    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) {
            throw unsupportedDefault(path, 'invalid Date');
        }
        return value.toISOString();
    }

    if (typeof value === 'object' || typeof value === 'function') {
        consumeDefaultThenable(value, path);
    }

    if (Array.isArray(value)) {
        return withAncestor(value, path, ancestors, () =>
            value.map((item, index) =>
                normalizeDefaultValue(item, `${path}[${String(index)}]`, true, ancestors),
            ),
        );
    }

    if (typeof value === 'object') {
        const prototype: unknown = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            throw unsupportedDefault(path, value.constructor.name || 'object');
        }

        const record = value as Record<string, unknown>;
        if (Object.prototype.hasOwnProperty.call(record, serializedDefaultType)) {
            throw unsupportedDefault(path, `reserved '${serializedDefaultType}' key`);
        }
        if (Object.getOwnPropertySymbols(record).length > 0) {
            throw unsupportedDefault(path, 'symbol-keyed property');
        }

        return withAncestor(value, path, ancestors, () =>
            Object.fromEntries(
                Object.entries(record).sort(([left], [right]) =>
                    compareJsonKeys(left, right)).map(([key, item]) => [
                    key,
                    normalizeDefaultValue(
                        item,
                        `${path}.${key}`,
                        true,
                        ancestors,
                    ),
                ]),
            ),
        );
    }

    throw unsupportedDefault(path, typeof value);
}

function consumeDefaultThenable(value: object, path: string): void {
    let descriptors: PropertyDescriptorMap;
    try {
        descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
        return;
    }
    const then = ownThenFunction(descriptors) ??
        readInheritedThen(value, descriptors);
    if (typeof then !== 'function') {
        return;
    }
    consumeThenable(value, then as (...args: unknown[]) => unknown);
    throw unsupportedDefault(path, 'Promise or thenable');
}

function withAncestor<TResult>(
    value: object,
    path: string,
    ancestors: Set<object>,
    work: () => TResult,
): TResult {
    if (ancestors.has(value)) {
        throw unsupportedDefault(path, 'cyclic reference');
    }
    ancestors.add(value);
    try {
        return work();
    } finally {
        ancestors.delete(value);
    }
}

function unsupportedDefault(path: string, actual: string): TypeError {
    return new TypeError(
        `Unsupported default value at ${path} (${actual}). ` +
    'Use null, a string, a finite number, a boolean, a bigint, a valid Date, ' +
    'or a JSON-compatible array/object. Use defaultSql(...) for provider expressions.',
    );
}
