import type { JsonValue } from '../json-value';
import { compareJsonKeys } from './canonical-json';
import {
    jsonChildPath,
    jsonChildPropertyPath,
    isJsonArrayIndex,
    rejectJson,
    withJsonAncestor,
    type JsonNormalizationState,
} from './json-normalization-state';

export type NormalizeJsonChild = (
    value: unknown,
    path: string,
    state: JsonNormalizationState,
) => JsonValue;

export function normalizeJsonArray(
    value: unknown[],
    descriptors: PropertyDescriptorMap,
    path: string,
    state: JsonNormalizationState,
    normalize: NormalizeJsonChild,
): JsonValue {
    return withJsonAncestor(value, state, () => {
        const normalized: JsonValue[] = [];
        for (let index = 0; index < value.length; index += 1) {
            const key = String(index);
            if (!Object.prototype.hasOwnProperty.call(descriptors, key)) {
                rejectJson(state, `${path}[${key}]`, 'missing array element');
                normalized.push(null);
                continue;
            }
            normalized.push(normalizeDescriptor(
                descriptors[key], `${path}[${key}]`, state, normalize,
            ));
        }

        drainArrayProperties(value, descriptors, path, state, normalize);
        state.snapshots.set(value, normalized);
        return normalized;
    });
}

export function normalizeJsonObject(
    value: object,
    descriptors: PropertyDescriptorMap,
    path: string,
    state: JsonNormalizationState,
    normalize: NormalizeJsonChild,
): JsonValue {
    return withJsonAncestor(value, state, () => {
        const normalized: Record<string, JsonValue> = {};
        const keys = Reflect.ownKeys(descriptors);
        for (const key of keys) {
            const descriptor = descriptors[key];
            if (typeof key === 'symbol') {
                rejectJson(state, path, 'symbol-keyed property');
                drainJsonDescriptor(descriptor, jsonChildPropertyPath(path, key), state, normalize);
            }
        }
        const propertyNames = keys
            .filter((key): key is string =>
                typeof key === 'string' && descriptors[key].enumerable === true)
            .sort(compareJsonKeys);
        for (const key of propertyNames) {
            normalized[key] = normalizeDescriptor(
                descriptors[key], jsonChildPath(path, key), state, normalize,
            );
        }
        state.snapshots.set(value, normalized);
        return normalized;
    });
}

export function drainJsonDescriptors(
    value: object,
    descriptors: PropertyDescriptorMap,
    path: string,
    state: JsonNormalizationState,
    normalize: NormalizeJsonChild,
): void {
    withJsonAncestor(value, state, () => {
        for (const key of Reflect.ownKeys(descriptors)) {
            const descriptor = descriptors[key];
            if (descriptor.enumerable) {
                drainJsonDescriptor(
                    descriptor, jsonChildPropertyPath(path, key), state, normalize,
                );
            }
        }
    });
}

function drainArrayProperties(
    value: unknown[],
    descriptors: PropertyDescriptorMap,
    path: string,
    state: JsonNormalizationState,
    normalize: NormalizeJsonChild,
): void {
    for (const key of Reflect.ownKeys(descriptors)) {
        if (key === 'length' || isJsonArrayIndex(key, value.length)) {
            continue;
        }
        const descriptor = descriptors[key];
        if (typeof key === 'string' && !descriptor.enumerable) {
            continue;
        }
        rejectJson(
            state,
            path,
            typeof key === 'symbol'
                ? 'symbol-keyed property'
                : `extra array property '${key}'`,
        );
        drainJsonDescriptor(
            descriptor, jsonChildPropertyPath(path, key), state, normalize,
        );
    }
}

function normalizeDescriptor(
    descriptor: PropertyDescriptor,
    path: string,
    state: JsonNormalizationState,
    normalize: NormalizeJsonChild,
): JsonValue {
    if (!('value' in descriptor)) {
        rejectJson(state, path, 'accessor property');
        return null;
    }
    return normalize(descriptor.value, path, state);
}

function drainJsonDescriptor(
    descriptor: PropertyDescriptor,
    path: string,
    state: JsonNormalizationState,
    normalize: NormalizeJsonChild,
): void {
    if ('value' in descriptor) {
        normalize(descriptor.value, path, state);
    }
}
