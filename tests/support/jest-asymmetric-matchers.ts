/**
 * Typed bridges for Jest's asymmetric matchers, whose public declarations
 * intentionally return `any`.
 */
export function anyNumber(): number {
    const matcher: unknown = expect.any(Number);
    return matcher as number;
}

export function anyError(): Error {
    const matcher: unknown = expect.any(Error);
    return matcher as Error;
}

export function containing<const TValue extends object>(
    expected: Partial<TValue>,
): TValue {
    const matcher: unknown = expect.objectContaining(expected);
    return matcher as TValue;
}

export function arrayContaining<const TValue extends readonly unknown[]>(
    expected: TValue,
): TValue {
    const matcher: unknown = expect.arrayContaining(expected);
    return matcher as TValue;
}

export function stringContaining(value: string): string {
    const matcher: unknown = expect.stringContaining(value);
    return matcher as string;
}
