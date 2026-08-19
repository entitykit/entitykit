export function cloneSnapshotValue(value: unknown): unknown {
    return cloneValue(value, new WeakMap<object, unknown>());
}

function cloneValue(value: unknown, seen: WeakMap<object, unknown>): unknown {
    if (typeof value !== 'object' || value === null) {
        return value;
    }
    if (value instanceof Promise) {
        // Promises are unsupported persisted values. Preserve the original so
        // the owning validator can consume a rejection and report its path.
        return value;
    }
    if (value instanceof Date) {
        return new Date(value.getTime());
    }
    if (value instanceof RegExp) {
        const clone = new RegExp(value.source, value.flags);
        clone.lastIndex = value.lastIndex;
        return clone;
    }
    if (value instanceof ArrayBuffer) {
        return value.slice(0);
    }
    if (ArrayBuffer.isView(value)) {
        return cloneArrayBufferView(value);
    }

    const existing = seen.get(value);
    if (existing !== undefined) {
        return existing;
    }
    if (Array.isArray(value)) {
        const clone: unknown[] = [];
        seen.set(value, clone);
        for (const item of value) {
            clone.push(cloneValue(item, seen));
        }
        return clone;
    }
    if (value instanceof Map) {
        const clone: Map<unknown, unknown> = new Map();
        seen.set(value, clone);
        for (const [key, item] of value) {
            clone.set(cloneValue(key, seen), cloneValue(item, seen));
        }
        return clone;
    }
    if (value instanceof Set) {
        const clone: Set<unknown> = new Set();
        seen.set(value, clone);
        for (const item of value) {
            clone.add(cloneValue(item, seen));
        }
        return clone;
    }

    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== null && typeof prototype !== 'object') {
        throw new TypeError('Snapshot values must have an object or null prototype.');
    }
    const clone = Object.create(prototype) as Record<PropertyKey, unknown>;
    seen.set(value, clone);
    for (const key of enumerableOwnKeys(value)) {
        Object.defineProperty(clone, key, {
            configurable: true,
            enumerable: true,
            value: cloneValue(
                (value as Record<PropertyKey, unknown>)[key],
                seen,
            ),
            writable: true,
        });
    }
    return clone;
}

function cloneArrayBufferView(value: ArrayBufferView): ArrayBufferView {
    const bytes = new Uint8Array(value.byteLength);
    bytes.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    if (value instanceof DataView) {
        return new DataView(bytes.buffer);
    }

    const View = value.constructor as new (
        buffer: ArrayBuffer
    ) => ArrayBufferView;
    return new View(bytes.buffer);
}

function enumerableOwnKeys(value: object): PropertyKey[] {
    return Reflect.ownKeys(value).filter(key =>
        Object.prototype.propertyIsEnumerable.call(value, key),
    );
}
