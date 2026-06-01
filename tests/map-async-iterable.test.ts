import { mapAsyncIterable } from '../src/storage/map-async-iterable';

describe('mapAsyncIterable', () => {
    it('maps lazily and cleans up after early iterator disposal', async () => {
        const visited: number[] = [];
        let cleaned = false;
        const source = async function* (): AsyncGenerator<number> {
            for (const value of [1, 2]) {
                await Promise.resolve();
                visited.push(value);
                yield value;
            }
        };
        const iterator = mapAsyncIterable(
            source(),
            value => value * 2,
            () => {
                cleaned = true;
            },
        )[Symbol.asyncIterator]();

        expect(visited).toEqual([]);
        await expect(iterator.next()).resolves.toEqual({ done: false, value: 2 });
        await iterator.return(undefined);

        expect(visited).toEqual([1]);
        expect(cleaned).toBe(true);
    });
});
