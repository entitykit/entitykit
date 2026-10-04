/** Observe library rejection ownership independently of the test's fallback. */
export function observedJsonRejection(reason: Error): {
    readonly promise: Promise<never>;
    readonly observed: () => boolean;
} {
    const promise = Promise.reject(reason);
    let rejectionHandlers = 0;
    const original = promise.then.bind(promise);
    void Object.defineProperty(promise, 'then', {
        configurable: true,
        value: async <TResult1 = never, TResult2 = never>(
            onFulfilled?: ((value: never) => TResult1 | PromiseLike<TResult1>) | null,
            onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ): Promise<TResult1 | TResult2> => {
            if (typeof onRejected === 'function') rejectionHandlers += 1;
            return await original(onFulfilled, onRejected);
        },
    });
    // Call the native method directly: this handler cannot count as library work.
    void Promise.prototype.then.call(promise, undefined, () => undefined);
    return { promise, observed: () => rejectionHandlers > 0 };
}
