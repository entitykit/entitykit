export function incrementVersionValue(
    value: unknown,
    propertyPath: string,
): unknown {
    if (typeof value === 'number') {
        return value + 1;
    }
    if (typeof value === 'bigint') {
        return value + 1n;
    }
    if (typeof value === 'string' && /^-?\d+$/.test(value)) {
        return (BigInt(value) + 1n).toString();
    }

    throw new Error(
        `Version property '${propertyPath}' holds a non-numeric value (${typeof value}) and cannot be incremented after save. Version columns must map to a number, a bigint, or an integer string.`,
    );
}
