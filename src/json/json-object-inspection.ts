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
            descriptors: Object.getOwnPropertyDescriptors(value),
        };
    } catch {
        rejectJson(state, path, 'property inspection failed');
        return undefined;
    }
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
    const constructor = prototype === null
        ? undefined
        : Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value as unknown;
    return typeof constructor === 'function' && constructor.name
        ? constructor.name
        : 'object';
}
