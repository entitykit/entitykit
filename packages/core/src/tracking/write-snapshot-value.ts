/** Store a mapped key on an owned snapshot without changing its prototype. */
export function writeSnapshotValue(
    values: Record<string, unknown>,
    key: string,
    value: unknown,
): void {
    if (key === '__proto__') {
        Object.defineProperty(values, key, {
            configurable: true,
            enumerable: true,
            writable: true,
            value,
        });
    } else {
        values[key] = value;
    }
}
