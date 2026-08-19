import {
    consumeThenable,
    ownThenFunction,
    readInheritedThen,
} from '../json/json-object-inspection';

/** Consume a default thenable rejection and report that it was found. */
export function consumeDefaultThenable(value: object): boolean {
    let descriptors: PropertyDescriptorMap;
    try {
        descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
        return false;
    }
    const then = ownThenFunction(descriptors) ??
        readInheritedThen(value, descriptors);
    if (typeof then !== 'function') {
        return false;
    }
    consumeThenable(value, then as (...args: unknown[]) => unknown);
    return true;
}
