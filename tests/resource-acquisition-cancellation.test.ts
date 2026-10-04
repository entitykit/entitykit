import { acquireWithOperationCancellation } from '@entitykit/core/adapter';
import { OperationCanceledError } from '@entitykit/core';

describe('resource acquisition cancellation', () => {
    it('acquires without a signal and transfers ownership to the caller', async () => {
        const resource = { id: 1 };
        const acquire = jest.fn(async () => Promise.resolve(resource));
        const release = jest.fn();
        await expect(acquireWithOperationCancellation(acquire, release)).resolves.toBe(resource);
        expect(acquire).toHaveBeenCalledTimes(1);
        expect(release).not.toHaveBeenCalled();
    });

    it('cleans up its listener when acquisition throws synchronously', async () => {
        const controller = new AbortController();
        const remove = jest.spyOn(controller.signal, 'removeEventListener');
        const failure = new Error('pool already closed');
        await expect(acquireWithOperationCancellation(() => {
            throw failure;
        }, jest.fn(), controller.signal)).rejects.toBe(failure);
        expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    });

    it('reclaims a resource when acquisition synchronously triggers cancellation', async () => {
        const controller = new AbortController();
        const resource = { id: 1 };
        const release = jest.fn();
        await expect(acquireWithOperationCancellation(async () => {
            controller.abort('shutdown during acquisition');
            return Promise.resolve(resource);
        }, release, controller.signal)).rejects.toBeInstanceOf(OperationCanceledError);
        await new Promise<void>(resolve => setImmediate(resolve));
        expect(release).toHaveBeenCalledTimes(1);
        expect(release).toHaveBeenCalledWith(resource);
    });

    it('does not start acquiring when cancellation already happened', async () => {
        const controller = new AbortController();
        controller.abort('deadline');
        const acquire = jest.fn(async () => Promise.resolve({ id: 1 }));
        const release = jest.fn();

        await expect(acquireWithOperationCancellation(acquire, release, controller.signal))
            .rejects.toBeInstanceOf(OperationCanceledError);
        expect(acquire).not.toHaveBeenCalled();
        expect(release).not.toHaveBeenCalled();
    });

    it('rejects immediately and releases a resource that arrives later', async () => {
        const controller = new AbortController();
        const resource = { id: 1 };
        let deliver!: (value: typeof resource) => void;
        const queued: Promise<typeof resource> = new Promise(resolve => {
            deliver = resolve;
        });
        const release = jest.fn();
        const pending = acquireWithOperationCancellation(async () => queued, release, controller.signal);
        controller.abort('deadline');

        await expect(pending).rejects.toMatchObject({ cause: 'deadline' });
        expect(release).not.toHaveBeenCalled();
        deliver(resource);
        await new Promise<void>(resolve => setImmediate(resolve));
        expect(release).toHaveBeenCalledTimes(1);
        expect(release).toHaveBeenCalledWith(resource);
    });

    it('observes a failed acquisition after cancellation', async () => {
        const controller = new AbortController();
        let fail!: (error: Error) => void;
        const queued: Promise<never> = new Promise((_resolve, reject) => {
            fail = reject;
        });
        const release = jest.fn();
        const pending = acquireWithOperationCancellation(async () => queued, release, controller.signal);
        controller.abort('deadline');
        await expect(pending).rejects.toBeInstanceOf(OperationCanceledError);

        fail(new Error('pool closed'));
        await new Promise<void>(resolve => setImmediate(resolve));
        expect(release).not.toHaveBeenCalled();
    });

    it('transfers successful ownership without releasing the resource', async () => {
        const resource = { id: 1 };
        const release = jest.fn();
        const controller = new AbortController();
        await expect(acquireWithOperationCancellation(
            async () => Promise.resolve(resource), release, controller.signal,
        )).resolves.toBe(resource);
        controller.abort('after ownership transfer');
        expect(release).not.toHaveBeenCalled();
    });

    it('preserves the acquisition failure and removes its abort listener', async () => {
        const failure = new Error('pool closed');
        const controller = new AbortController();
        const remove = jest.spyOn(controller.signal, 'removeEventListener');
        await expect(acquireWithOperationCancellation(
            async () => Promise.reject(failure), jest.fn(), controller.signal,
        )).rejects.toBe(failure);
        expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    });

    it.each(['synchronous', 'asynchronous'])('wraps a non-Error %s acquisition failure', async kind => {
        const controller = new AbortController();
        const reason = { poolState: 'closed' };
        const release = jest.fn();
        // Third-party acquisition callbacks can throw or reject arbitrary values.
        const acquire = kind === 'synchronous'
            ? (): never => {
                // eslint-disable-next-line @typescript-eslint/only-throw-error
                throw reason;
            }
            : async (): Promise<never> => {
                // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
                return Promise.reject(reason);
            };
        await expect(acquireWithOperationCancellation(acquire, release, controller.signal)).rejects.toMatchObject({
            message: 'Resource acquisition failed.', cause: reason,
        });
        controller.abort('after failure');
        expect(release).not.toHaveBeenCalled();
    });

    it('reports rejected late cleanup without exposing its error or abandoning a promise', async () => {
        const warning = jest.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
        const controller = new AbortController();
        let deliver!: (resource: object) => void;
        const queued: Promise<object> = new Promise(resolve => {
            deliver = resolve;
        });
        try {
            const pending = acquireWithOperationCancellation(
                async () => queued,
                async () => Promise.reject(new Error('password=private-driver-value')),
                controller.signal,
            );
            controller.abort('deadline');
            await expect(pending).rejects.toBeInstanceOf(OperationCanceledError);
            deliver({});
            await new Promise<void>(resolve => setImmediate(resolve));
            expect(warning).toHaveBeenCalledWith(
                'Releasing a resource acquired after cancellation failed.',
                { code: 'ENTITYKIT_CANCELED_RESOURCE_CLEANUP' },
            );
        } finally {
            warning.mockRestore();
        }
    });
});
