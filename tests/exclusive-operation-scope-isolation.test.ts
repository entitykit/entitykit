import { AsyncLocalStorage } from 'node:async_hooks';
import { ContextConcurrentOperationError } from '@entitykit/core';
import { ExclusiveOperationGuard } from '../packages/core/src/storage/exclusive-operation-guard';

function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise: Promise<void> = new Promise(done => {
        resolve = done;
    });
    return { promise, resolve };
}

describe('shared operation scope isolation', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('finds each owning guard through nested guards and restores the outer chain', async () => {
        const outer = new ExclusiveOperationGuard();
        const inner = new ExclusiveOperationGuard();
        await outer.run('outer transaction', async () => {
            await inner.run('inner transaction', async () => {
                await expect(outer.runQuery('outer query', async () => await Promise.resolve(1)))
                    .resolves.toBe(1);
                await expect(inner.runQuery('inner query', async () => await Promise.resolve(2)))
                    .resolves.toBe(2);
                expect(outer.isOperationInProgress).toBe(true);
                expect(inner.isOperationInProgress).toBe(true);
            });
            expect(inner.isOperationInProgress).toBe(false);
            await expect(outer.runQuery('after inner completion', async () => await Promise.resolve(3)))
                .resolves.toBe(3);
        });
        expect(outer.isOperationInProgress).toBe(false);
    });

    it('does not let a different guard hide an overlapping ancestor query or stream', async () => {
        const outer = new ExclusiveOperationGuard();
        const inner = new ExclusiveOperationGuard();
        await outer.runQuery('outer query', async () => {
            await inner.run('inner session', async () => {
                const work = jest.fn(async () => await Promise.resolve(42));
                await expect(outer.runQuery('overlap', work))
                    .rejects.toBeInstanceOf(ContextConcurrentOperationError);
                expect(work).not.toHaveBeenCalled();
                const rows = jest.fn(async function* (): AsyncGenerator<number> {
                    yield await Promise.resolve(42);
                });
                await expect(outer.stream(rows).next())
                    .rejects.toBeInstanceOf(ContextConcurrentOperationError);
                expect(rows).not.toHaveBeenCalled();
            });
        });
        expect(outer.isOperationInProgress).toBe(false);
    });

    it('keeps concurrent roots independent when one finishes before the other', async () => {
        const first = new ExclusiveOperationGuard();
        const second = new ExclusiveOperationGuard();
        const release = deferred();
        const pending = first.run('first transaction', async () => {
            await release.promise;
            await expect(first.runQuery('still owned', async () => await Promise.resolve(42)))
                .resolves.toBe(42);
        });
        try {
            await second.run('second transaction', async () => {
                await expect(first.runQuery('unrelated chain', async () => await Promise.resolve(0)))
                    .rejects.toBeInstanceOf(ContextConcurrentOperationError);
                await expect(second.runQuery('second query', async () => await Promise.resolve(1)))
                    .resolves.toBe(1);
            });
            expect(second.isOperationInProgress).toBe(false);
            expect(first.isOperationInProgress).toBe(true);
        } finally {
            release.resolve();
            await pending;
        }
    });

    it('retains a live ancestor when a child continues after an intermediate scope expires', async () => {
        const outer = new ExclusiveOperationGuard();
        const inner = new ExclusiveOperationGuard();
        const later = new ExclusiveOperationGuard();
        const wake = deferred();
        let child!: Promise<number>;
        await outer.run('outer transaction', async () => {
            await inner.run('inner transaction', async () => {
                child = wake.promise.then(async () => await later.run('later session', async () =>
                    await outer.runQuery('outer query', async () => await Promise.resolve(42))));
                await Promise.resolve();
            });
            wake.resolve();
            await expect(child).resolves.toBe(42);
            expect(outer.isOperationInProgress).toBe(true);
            expect(inner.isOperationInProgress).toBe(false);
        });
    });

    it('does not retain expired ancestors across a sequence of detached continuations', async () => {
        const run = jest.spyOn(AsyncLocalStorage.prototype, 'run');
        const pending: Array<Promise<void>> = [];
        async function next(remaining: number): Promise<void> {
            if (remaining === 0) return;
            const wake = deferred();
            await new ExclusiveOperationGuard().run('request', async () => {
                pending.push(wake.promise.then(async () => {
                    await next(remaining - 1);
                }));
                await Promise.resolve();
            });
            wake.resolve();
        }
        await next(256);
        for (const continuation of pending) await continuation;
        expect(run).toHaveBeenCalledTimes(256);
        for (const [scope] of run.mock.calls) {
            expect(scope).toHaveProperty('parent', undefined);
        }
    });
});
