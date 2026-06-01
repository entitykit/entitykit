export function requireDefined<T>(
    value: T | null | undefined,
    description = 'value',
): T {
    if (value === null || value === undefined) {
        throw new Error(`Expected ${description} to be defined.`);
    }

    return value;
}
