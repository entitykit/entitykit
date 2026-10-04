import { OperationCanceledError } from '@entitykit/core';
import { awaitWithOperationCancellation } from '@entitykit/core/adapter';

function observeOperation<TResult>(
    operation: Promise<TResult>,
    signal?: AbortSignal,
): { pending: Promise<TResult>; observesRejection: boolean; verify: () => Promise<void> } {
    const then = jest.spyOn(operation, 'then');
    const pending = awaitWithOperationCancellation(operation, signal);
    // Record ownership before test cleanup can handle a driver's late failure.
    const observesRejection = then.mock.calls.some(([, reject]) => typeof reject === 'function');
    const branchFailures: unknown[] = [];
    for (const result of then.mock.results) {
        const branch: unknown = result.value;
        if (result.type === 'return' && branch instanceof Promise) {
            void branch.catch((reason: unknown) => {
                branchFailures.push(reason);
            });
        }
    }
    // Failed implementations must produce assertions, not unhandled rejections.
    void operation.catch(() => undefined);
    void pending.catch(() => undefined);
    return {
        pending,
        observesRejection,
        verify: async (): Promise<void> => {
            await new Promise<void>(resolve => setImmediate(resolve));
            then.mockRestore();
            expect(branchFailures).toEqual([]);
        },
    };
}

describe('cancellation of already-started promises', () => {
    it('observes a rejected operation when its signal was already aborted', async () => {
        const controller = new AbortController();
        controller.abort('deadline');
        const operation = Promise.reject(new Error('late driver failure'));
        const observed = observeOperation(operation, controller.signal);

        expect(observed.observesRejection).toBe(true);
        await expect(observed.pending)
            .rejects.toMatchObject({ name: 'OperationCanceledError', cause: 'deadline' });
        await observed.verify();
    });

    it('observes rejection after cancellation has already reached the caller', async () => {
        const controller = new AbortController();
        let fail!: (reason: Error) => void;
        const operation: Promise<never> = new Promise((_resolve, reject) => {
            fail = reject;
        });
        const observed = observeOperation(operation, controller.signal);
        expect(observed.observesRejection).toBe(true);
        controller.abort('deadline');

        await expect(observed.pending).rejects.toBeInstanceOf(OperationCanceledError);
        fail(new Error('late driver failure'));
        await observed.verify();
    });

    it('preserves a successful operation without a cancellation signal', async () => {
        const observed = observeOperation(Promise.resolve(42));
        await expect(observed.pending).resolves.toBe(42);
        await observed.verify();
    });

    it('preserves the original operation failure before cancellation', async () => {
        const failure = new Error('driver failure');
        const controller = new AbortController();
        const observed = observeOperation(Promise.reject(failure), controller.signal);
        expect(observed.observesRejection).toBe(true);
        await expect(observed.pending)
            .rejects.toBe(failure);
        await observed.verify();
    });

    it('removes the abort listener after successful work transfers its result', async () => {
        const controller = new AbortController();
        const remove = jest.spyOn(controller.signal, 'removeEventListener');
        const observed = observeOperation(Promise.resolve(42), controller.signal);
        expect(observed.observesRejection).toBe(true);
        await expect(observed.pending).resolves.toBe(42);
        await observed.verify();
        expect(remove).toHaveBeenCalledTimes(1);
        controller.abort('after result transfer');
        expect(remove).toHaveBeenCalledTimes(1);
    });

    it('wraps a non-Error rejection while retaining the original cause', async () => {
        const controller = new AbortController();
        const reason = { driverStatus: 'disconnected' };
        // A third-party driver can reject with an arbitrary value.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        const observed = observeOperation(Promise.reject(reason), controller.signal);
        expect(observed.observesRejection).toBe(true);
        await expect(observed.pending).rejects.toMatchObject({
            message: 'The database operation failed.', cause: reason,
        });
        await observed.verify();
    });
});
