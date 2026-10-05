import { types } from 'node:util';

/** Inspect participating descriptors without executing application hooks. */
export function navigationPropertyHasDynamicBehavior(entity: object, property: string): boolean {
    let owner: object | null = entity;
    while (owner) {
        if (types.isProxy(owner)) return true;
        const descriptor = Object.getOwnPropertyDescriptor(owner, property);
        if (descriptor) return 'get' in descriptor || collectionHasDynamicBehavior(descriptor.value);
        owner = Object.getPrototypeOf(owner) as object | null;
    }
    return false;
}

function collectionHasDynamicBehavior(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    if (types.isProxy(value)) return true;
    if (!Array.isArray(value)) return false;
    if (Object.getPrototypeOf(value) !== Array.prototype) return true;
    // Native arrays have only length and data-index descriptors. Own methods,
    // iterators, constructors and indexed accessors can execute application code.
    for (const key of Reflect.ownKeys(value)) {
        if (key === 'length') continue;
        if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key)) return true;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || 'get' in descriptor) return true;
    }
    return false;
}
