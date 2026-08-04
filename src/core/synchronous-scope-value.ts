import { assertSynchronousCallbackResult } from '../synchronous-callback';

export function readSynchronousScopeValue(
    provider: (() => unknown) | undefined,
    operation: string,
): unknown {
    const value = provider?.();
    assertSynchronousCallbackResult(
        value,
        operation,
        message => new Error(message),
    );
    return value;
}
