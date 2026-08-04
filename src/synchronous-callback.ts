import { isPromiseLike } from './promise-like';

export function assertSynchronousCallbackResult(
    result: unknown,
    operation: string,
    createError: (message: string) => Error,
): void {
    if (!isPromiseLike(result)) {
        return;
    }

    void Promise.resolve(result).catch(() => undefined);
    throw createError(
        `${operation} must be synchronous and must not return a Promise.`,
    );
}
