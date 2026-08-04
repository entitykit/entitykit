import { assertSynchronousCallbackResult } from './synchronous-callback';

export function readSynchronousValue<TValue>(
    provider: (() => TValue) | undefined,
    operation: string,
): TValue | undefined {
    const value = provider?.();
    assertSynchronousCallbackResult(
        value,
        operation,
        message => new TypeError(message),
    );
    return value;
}

export function readSynchronousDate(
    provider: (() => Date) | undefined,
    operation: string,
): Date | undefined {
    const value = readSynchronousValue(provider, operation);
    if (value !== undefined && !(value instanceof Date)) {
        throw new TypeError(`${operation} must return a Date.`);
    }
    return value;
}
