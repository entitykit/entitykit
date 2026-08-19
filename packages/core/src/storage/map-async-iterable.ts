/** Lazily map an async sequence and run optional cleanup when iteration ends. */
export async function* mapAsyncIterable<TSource, TResult>(
    source: AsyncIterable<TSource>,
    map: (value: TSource) => TResult,
    cleanup?: () => void,
): AsyncGenerator<TResult> {
    try {
        for await (const value of source) {
            yield map(value);
        }
    } finally {
        cleanup?.();
    }
}
