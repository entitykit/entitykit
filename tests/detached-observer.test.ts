import { invokeDetachedObserver } from '../src/diagnostics/detached-observer';

describe('detached observer', () => {
    it('suppresses synchronous observer failures', () => {
        const failure = new Error('observer failed');

        expect(() => {
            invokeDetachedObserver(() => {
                throw failure;
            });
        }).not.toThrow();
    });

    it('consumes asynchronous observer rejections', async () => {
        let observerFinished = false;

        invokeDetachedObserver(async () => {
            await Promise.resolve();
            observerFinished = true;
            throw new Error('async observer failed');
        });
        await new Promise<void>(resolve => setImmediate(resolve));

        expect(observerFinished).toBe(true);
    });
});
