import { ContextConcurrentOperationError } from '@entitykit/core';
import { ExclusiveOperationGuard } from '../packages/core/src/storage/exclusive-operation-guard';

function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise: Promise<void> = new Promise(done => {
        resolve = done;
    });
    return { promise, resolve };
}

async function* rows(): AsyncGenerator<number> {
    await Promise.resolve();
    yield 42;
    yield 43;
}

describe('exclusive stream and nested query ownership', () => {
    it('owns a root stream until return and refuses competing work before acquisition', async () => {
        const guard = new ExclusiveOperationGuard();
        const iterator = guard.stream(rows);
        expect(await iterator.next()).toEqual({ value: 42, done: false });
        expect(guard.isOperationInProgress).toBe(true);
        const query = jest.fn(async () => await Promise.resolve(1));
        await expect(guard.runQuery('competing query', query)).rejects.toBeInstanceOf(ContextConcurrentOperationError);
        expect(query).not.toHaveBeenCalled();
        const createRows = jest.fn(rows);
        await expect(guard.stream(createRows).next()).rejects.toMatchObject({
            code: 'CONTEXT_CONCURRENT_OPERATION', details: { operation: 'a streaming query' },
        });
        expect(createRows).not.toHaveBeenCalled();
        await iterator.return(undefined);
        expect(guard.isOperationInProgress).toBe(false);
        await expect(guard.runQuery('recovery', query)).resolves.toBe(1);
    });

    it('releases a root stream after normal exhaustion', async () => {
        const guard = new ExclusiveOperationGuard();
        const values: number[] = [];
        for await (const row of guard.stream(rows)) values.push(row);
        expect(values).toEqual([42, 43]);
        expect(guard.isOperationInProgress).toBe(false);
        await expect(guard.runQuery('recovery', async () => await Promise.resolve(44))).resolves.toBe(44);
    });

    it.each(['creation', 'iteration'])('releases a root stream after %s fails', async stage => {
        const guard = new ExclusiveOperationGuard();
        const failure = new Error('cursor failed');
        const createRows = (): AsyncIterable<number> => {
            if (stage === 'creation') throw failure;
            return (async function* (): AsyncGenerator<number> {
                await Promise.resolve();
                yield 42;
                throw failure;
            })();
        };
        const iterator = guard.stream(createRows);
        if (stage === 'iteration') await iterator.next();
        await expect(iterator.next()).rejects.toBe(failure);
        expect(guard.isOperationInProgress).toBe(false);
        await expect(guard.runQuery('recovery', async () => await Promise.resolve(44))).resolves.toBe(44);
    });

    it('borrows the parent token and releases only its query ownership on return', async () => {
        const guard = new ExclusiveOperationGuard();
        await guard.run('owning transaction', async () => {
            const iterator = guard.stream(rows);
            expect(await iterator.next()).toEqual({ value: 42, done: false });
            await expect(guard.runQuery('overlapping query', async () => await Promise.resolve(1)))
                .rejects.toBeInstanceOf(ContextConcurrentOperationError);
            await expect(guard.stream(rows).next()).rejects.toMatchObject({
                code: 'CONTEXT_CONCURRENT_OPERATION', details: { operation: 'a streaming query' },
            });
            expect(guard.isOperationInProgress).toBe(true);
            await iterator.return(undefined);
            expect(guard.isOperationInProgress).toBe(true);
            await expect(guard.runQuery('next query', async () => await Promise.resolve(44))).resolves.toBe(44);
        });
        expect(guard.isOperationInProgress).toBe(false);
    });

    it('preserves the parent operation when a borrowed stream fails', async () => {
        const guard = new ExclusiveOperationGuard();
        const failure = new Error('cursor creation failed');
        await guard.run('owning transaction', async () => {
            await expect(guard.stream(() => {
                throw failure;
            }).next()).rejects.toBe(failure);
            expect(guard.isOperationInProgress).toBe(true);
            await expect(guard.runQuery('next query', async () => await Promise.resolve(44))).resolves.toBe(44);
        });
        expect(guard.isOperationInProgress).toBe(false);
    });

    it('refuses overlapping nested queries and streams without ending the parent operation', async () => {
        const guard = new ExclusiveOperationGuard();
        const release = deferred();
        await guard.run('owning transaction', async () => {
            const pending = guard.runQuery('first query', async () => {
                await release.promise;
                return 42;
            }).then(value => ({ value }), (error: unknown) => ({ error }));
            try {
                const competing = jest.fn(async () => await Promise.resolve(1));
                await expect(guard.runQuery('second query', competing)).rejects.toBeInstanceOf(ContextConcurrentOperationError);
                expect(competing).not.toHaveBeenCalled();
                const createRows = jest.fn(rows);
                await expect(guard.stream(createRows).next()).rejects.toMatchObject({
                    details: { operation: 'a streaming query' },
                });
                expect(createRows).not.toHaveBeenCalled();
                expect(guard.isOperationInProgress).toBe(true);
            } finally {
                release.resolve();
            }
            expect(await pending).toEqual({ value: 42 });
            await expect(guard.runQuery('next query', async () => await Promise.resolve(44))).resolves.toBe(44);
        });
        expect(guard.isOperationInProgress).toBe(false);
    });

    it.each(['operation', 'stream'])('refuses an expired async chain\'s %s while a new root owns the guard', async kind => {
        const guard = new ExclusiveOperationGuard();
        const wake = deferred();
        const release = deferred();
        let late!: Promise<number>;
        await guard.run('former root', async () => {
            late = wake.promise.then(async () => {
                if (kind === 'operation') return await guard.run('expired child', async () => await Promise.resolve(42));
                const iterator = guard.stream(rows);
                try {
                    await iterator.next();
                    return 42;
                } finally {
                    await iterator.return(undefined);
                }
            });
            await Promise.resolve();
        });
        const root = guard.run('current root', async () => {
            await release.promise;
        });
        try {
            const rejected = expect(late).rejects.toBeInstanceOf(ContextConcurrentOperationError);
            wake.resolve();
            await rejected;
            expect(guard.isOperationInProgress).toBe(true);
        } finally {
            release.resolve();
            await root;
        }
        expect(guard.isOperationInProgress).toBe(false);
    });
});
