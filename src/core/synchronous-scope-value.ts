import { readSynchronousValue } from '../synchronous-value';

export function readSynchronousScopeValue(
    provider: (() => unknown) | undefined,
    operation: string,
): unknown {
    return readSynchronousValue(provider, operation);
}
