import type { JsonValue } from '../json-value';
import {
    drainJsonDescriptors,
    normalizeJsonArray,
    normalizeJsonObject,
} from './json-container-normalizer';
import {
    createJsonNormalizationState,
    rejectJson,
    type JsonNormalizationState,
} from './json-normalization-state';
import {
    consumeThenable,
    inspectJsonObject,
    jsonObjectTypeName,
    ownThenFunction,
    readInheritedThen,
} from './json-object-inspection';

export function normalizeUnknownJson(value: unknown, path: string): JsonValue {
    const state = createJsonNormalizationState();
    const normalized = normalize(value, path, state);
    if (state.firstError) {
        throw state.firstError;
    }
    return normalized;
}

function normalize(
    value: unknown,
    path: string,
    state: JsonNormalizationState,
): JsonValue {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            rejectJson(state, path, String(value));
            return null;
        }
        return value;
    }
    if (typeof value === 'function') {
        normalizeFunction(value, path, state);
        return null;
    }
    if (typeof value !== 'object') {
        rejectJson(state, path, typeof value);
        return null;
    }
    if (state.ancestors.has(value)) {
        rejectJson(state, path, 'cyclic reference');
        return null;
    }
    const existing = state.snapshots.get(value);
    if (existing !== undefined) {
        return existing;
    }

    const inspection = inspectJsonObject(value, path, state);
    if (!inspection) {
        return null;
    }
    const ownThen = ownThenFunction(inspection.descriptors);
    if (ownThen) {
        consumeThenable(value, ownThen);
        rejectJson(state, path, 'Promise or thenable');
        drainJsonDescriptors(value, inspection.descriptors, path, state, normalize);
        return null;
    }
    if (Array.isArray(value)) {
        return normalizeJsonArray(
            value, inspection.descriptors, path, state, normalize,
        );
    }
    if (inspection.prototype === Object.prototype || inspection.prototype === null) {
        return normalizeJsonObject(
            value, inspection.descriptors, path, state, normalize,
        );
    }

    const inheritedThen = readInheritedThen(value, inspection.descriptors);
    if (typeof inheritedThen === 'function') {
        consumeThenable(value, inheritedThen as (...args: unknown[]) => unknown);
        rejectJson(state, path, 'Promise or thenable');
    } else {
        rejectJson(state, path, jsonObjectTypeName(inspection.prototype));
    }
    drainJsonDescriptors(value, inspection.descriptors, path, state, normalize);
    return null;
}

function normalizeFunction(
    value: object,
    path: string,
    state: JsonNormalizationState,
): void {
    const inspection = inspectJsonObject(value, path, state);
    if (!inspection) {
        return;
    }
    const then = ownThenFunction(inspection.descriptors) ??
        readInheritedThen(value, inspection.descriptors);
    if (typeof then === 'function') {
        consumeThenable(value, then as (...args: unknown[]) => unknown);
        rejectJson(state, path, 'Promise or thenable');
    } else {
        rejectJson(state, path, 'function');
    }
    drainJsonDescriptors(value, inspection.descriptors, path, state, normalize);
}
