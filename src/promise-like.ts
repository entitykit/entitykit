export function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
    const canHaveThen = typeof value === 'object' && value !== null
        || typeof value === 'function';
    return canHaveThen
        && typeof (value as { readonly then?: unknown }).then === 'function';
}
