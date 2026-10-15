import { types } from 'node:util';
import {
    rejectJson,
    type JsonNormalizationState,
} from './json-normalization-state';

export interface JsonObjectInspection {
    readonly prototype: object | null;
    readonly descriptors: PropertyDescriptorMap;
}

export function inspectJsonObject(
    value: object,
    path: string,
    state: JsonNormalizationState,
): JsonObjectInspection | undefined {
    try {
        const prototype: object | null = Object.getPrototypeOf(value) as object | null;
        return {
            prototype,
            descriptors: snapshotJsonDescriptors(value),
        };
    } catch {
        rejectJson(state, path, 'property inspection failed');
        return undefined;
    }
}

/** Capture every descriptor before any recursive normalization can invoke user code. */
function snapshotJsonDescriptors(value: object): PropertyDescriptorMap {
    if (types.isProxy(value)) return Object.getOwnPropertyDescriptors(value);
    const descriptors = Object.create(null) as PropertyDescriptorMap;
    const keys = Reflect.ownKeys(value);
    // Descriptor collection itself must not invoke an array iterator or species hook.
    // eslint-disable-next-line @typescript-eslint/prefer-for-of -- Preserve descriptor collection without iterator observations.
    for (let index = 0; index < keys.length; index++) {
        const key = keys[index];
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor !== undefined) descriptors[key] = descriptor;
    }
    return descriptors;
}

export function ownThenFunction(
    descriptors: PropertyDescriptorMap,
): ((...args: unknown[]) => unknown) | undefined {
    if (!Object.prototype.hasOwnProperty.call(descriptors, 'then')) {
        return undefined;
    }
    const descriptor = descriptors.then;
    const candidate: unknown = 'value' in descriptor
        ? descriptor.value as unknown
        : undefined;
    return typeof candidate === 'function'
        ? candidate as (...args: unknown[]) => unknown
        : undefined;
}

export function readInheritedThen(
    value: object,
    descriptors: PropertyDescriptorMap,
): unknown {
    if (Object.prototype.hasOwnProperty.call(descriptors, 'then')) {
        return undefined;
    }
    try {
        return Reflect.get(value, 'then');
    } catch {
        return undefined;
    }
}

export function consumeThenable(
    value: object,
    then: (...args: unknown[]) => unknown,
): void {
    try {
        const settled = (): undefined => undefined;
        const result: unknown = Reflect.apply(then, value, [settled, settled]);
        if (result !== value) {
            void Promise.resolve(result).catch(() => undefined);
        }
    } catch {
        // Validation still rejects the thenable. A broken then() implementation
        // cannot be made safer by invoking it again.
    }
}

export function jsonObjectTypeName(prototype: object | null): string {
    try {
        const constructor = prototype === null
            ? undefined
            : Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value as unknown;
        const name: unknown = typeof constructor === 'function'
            ? Object.getOwnPropertyDescriptor(constructor, 'name')?.value as unknown
            : undefined;
        return typeof name === 'string' && name ? name : 'object';
    } catch {
        // Diagnostic metadata must not interrupt draining inspected values.
        return 'object';
    }
}
