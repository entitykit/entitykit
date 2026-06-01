export function snapshotValuesEqual(
    left: unknown,
    right: unknown,
    seen: WeakMap<object, WeakSet<object>> = new WeakMap(),
): boolean {
    if (Object.is(left, right)) {
        return true;
    }
    if (!isObject(left) || !isObject(right)) {
        return false;
    }
    if (left instanceof Date || right instanceof Date) {
        return left instanceof Date
      && right instanceof Date
      && Object.is(left.getTime(), right.getTime());
    }
    if (left instanceof RegExp || right instanceof RegExp) {
        return left instanceof RegExp
      && right instanceof RegExp
      && left.source === right.source
      && left.flags === right.flags
      && left.lastIndex === right.lastIndex;
    }
    if (isBinaryValue(left) || isBinaryValue(right)) {
        return sameBinaryValue(left, right);
    }
    if (Object.getPrototypeOf(left) !== Object.getPrototypeOf(right)) {
        return false;
    }
    if (alreadyCompared(left, right, seen)) {
        return true;
    }

    if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) =>
          snapshotValuesEqual(item, right[index], seen),
      );
    }
    if (left instanceof Map || right instanceof Map) {
        return left instanceof Map
      && right instanceof Map
      && orderedEntriesEqual(left, right, seen);
    }
    if (left instanceof Set || right instanceof Set) {
        return left instanceof Set
      && right instanceof Set
      && orderedValuesEqual(left, right, seen);
    }

    const leftKeys = enumerableOwnKeys(left);
    const rightKeys = enumerableOwnKeys(right);
    return leftKeys.length === rightKeys.length
    && leftKeys.every(key =>
        rightKeys.includes(key)
      && snapshotValuesEqual(
          (left as Record<PropertyKey, unknown>)[key],
          (right as Record<PropertyKey, unknown>)[key],
          seen,
      ),
    );
}

function orderedEntriesEqual(
    left: Map<unknown, unknown>,
    right: Map<unknown, unknown>,
    seen: WeakMap<object, WeakSet<object>>,
): boolean {
    if (left.size !== right.size) {
        return false;
    }
    const rightEntries = Array.from(right);
    return Array.from(left).every(([key, value], index) => {
        const candidate = rightEntries.at(index);
        return candidate !== undefined
      && snapshotValuesEqual(key, candidate[0], seen)
      && snapshotValuesEqual(value, candidate[1], seen);
    });
}

function orderedValuesEqual(
    left: Set<unknown>,
    right: Set<unknown>,
    seen: WeakMap<object, WeakSet<object>>,
): boolean {
    if (left.size !== right.size) {
        return false;
    }
    const rightValues = Array.from(right);
    return Array.from(left).every((value, index) =>
        snapshotValuesEqual(value, rightValues[index], seen),
    );
}

function alreadyCompared(
    left: object,
    right: object,
    seen: WeakMap<object, WeakSet<object>>,
): boolean {
    const compared = seen.get(left);
    if (compared?.has(right)) {
        return true;
    }
    const pairs = compared ?? new WeakSet();
    pairs.add(right);
    seen.set(left, pairs);
    return false;
}

function isObject(value: unknown): value is object {
    return typeof value === 'object' && value !== null;
}

function isBinaryValue(value: object): value is ArrayBuffer | ArrayBufferView {
    return value instanceof ArrayBuffer || ArrayBuffer.isView(value);
}

function sameBinaryValue(left: object, right: object): boolean {
    if (!isBinaryValue(left) || !isBinaryValue(right)) {
        return false;
    }
    if (Object.getPrototypeOf(left) !== Object.getPrototypeOf(right)) {
        return false;
    }
    const leftBytes = bytesOf(left);
    const rightBytes = bytesOf(right);
    return leftBytes.length === rightBytes.length
    && leftBytes.every((value, index) => value === rightBytes[index]);
}

function bytesOf(value: ArrayBuffer | ArrayBufferView): Uint8Array {
    return value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

function enumerableOwnKeys(value: object): PropertyKey[] {
    return Reflect.ownKeys(value).filter(key =>
        Object.prototype.propertyIsEnumerable.call(value, key),
    );
}
