import { AsyncLocalStorage } from 'node:async_hooks';
import { ExclusiveOperationGuard } from '../packages/core/src/storage/exclusive-operation-guard';

describe('exclusive operation scope lifetime', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('unregisters an idle guard after success and can run another operation', async () => {
        const disable = jest.spyOn(AsyncLocalStorage.prototype, 'disable');
        const guard = new ExclusiveOperationGuard();
        await expect(guard.runQuery('first', async () => await Promise.resolve(42))).resolves.toBe(42);
        expect(disable).toHaveBeenCalledTimes(1);
        expect(guard.isOperationInProgress).toBe(false);
        await expect(guard.runQuery('second', async () => await Promise.resolve(43))).resolves.toBe(43);
        expect(disable).toHaveBeenCalledTimes(2);
    });

    it('unregisters after failure without preventing a subsequent operation', async () => {
        const disable = jest.spyOn(AsyncLocalStorage.prototype, 'disable');
        const guard = new ExclusiveOperationGuard();
        await expect(guard.runQuery('failure', async () => {
            await Promise.resolve();
            throw new Error('driver failed');
        })).rejects.toThrow('driver failed');
        expect(disable).toHaveBeenCalledTimes(1);
        await expect(guard.runQuery('recovery', async () => await Promise.resolve(42))).resolves.toBe(42);
        expect(disable).toHaveBeenCalledTimes(2);
    });

    it('retains a nested transaction chain until the root finishes', async () => {
        const disable = jest.spyOn(AsyncLocalStorage.prototype, 'disable');
        const guard = new ExclusiveOperationGuard();
        await guard.run('transaction', async () => {
            await guard.runQuery('nested query', async () => {
                await Promise.resolve();
            });
            expect(disable).not.toHaveBeenCalled();
            expect(guard.isOperationInProgress).toBe(true);
            await guard.runQuery('another nested query', async () => {
                await Promise.resolve();
            });
        });
        expect(disable).toHaveBeenCalledTimes(1);
    });

    it('preserves the application async scope while releasing its own scope', async () => {
        const application: AsyncLocalStorage<string> = new AsyncLocalStorage();
        try {
            await application.run('request authority', async () => {
                const guard = new ExclusiveOperationGuard();
                await guard.runQuery('query', async () => {
                    await new Promise<void>(resolve => setImmediate(resolve));
                    expect(application.getStore()).toBe('request authority');
                });
                expect(application.getStore()).toBe('request authority');
            });
        } finally {
            application.disable();
        }
    });

    it('does not leave enabled guards registered as short-lived contexts accumulate', async () => {
        const disable = jest.spyOn(AsyncLocalStorage.prototype, 'disable');
        for (let index = 0; index < 256; index += 1) {
            await new ExclusiveOperationGuard().runQuery('request', async () => {
                await Promise.resolve();
            });
        }
        expect(disable).toHaveBeenCalledTimes(256);
    });
});
