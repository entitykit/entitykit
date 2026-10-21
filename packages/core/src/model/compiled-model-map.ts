/** A copied lookup whose backing Map never escapes, including through forEach. */
class CompiledModelMap implements ReadonlyMap<unknown, unknown> {
    readonly #values: Map<unknown, unknown> = new Map();
    public readonly [Symbol.toStringTag] = 'CompiledModelMap';

    constructor(
        source: Map<unknown, unknown>,
        copy: (value: unknown) => unknown,
        remember: (result: ReadonlyMap<unknown, unknown>) => void,
    ) {
        remember(this);
        for (const [key, value] of Map.prototype.entries.call(source)) {
            this.#values.set(copy(key), copy(value));
        }
        Object.freeze(this);
    }

    public get size(): number {
        return this.#values.size;
    }
    public get(key: unknown): unknown {
        return this.#values.get(key);
    }
    public has(key: unknown): boolean {
        return this.#values.has(key);
    }
    public entries(): MapIterator<[unknown, unknown]> {
        return this.#values.entries();
    }
    public keys(): MapIterator<unknown> {
        return this.#values.keys();
    }
    public values(): MapIterator<unknown> {
        return this.#values.values();
    }
    public [Symbol.iterator](): MapIterator<[unknown, unknown]> {
        return this.entries();
    }

    public forEach(
        callback: (value: unknown, key: unknown, map: ReadonlyMap<unknown, unknown>) => void,
        thisArg?: unknown,
    ): void {
        for (const [key, value] of this.#values) callback.call(thisArg, value, key, this);
    }
}

Object.freeze(CompiledModelMap.prototype);

export function copyCompiledModelMap(
    source: Map<unknown, unknown>,
    copy: (value: unknown) => unknown,
    remember: (result: ReadonlyMap<unknown, unknown>) => void,
): ReadonlyMap<unknown, unknown> {
    return new CompiledModelMap(source, copy, remember);
}
