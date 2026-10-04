import { OperationCanceledError } from '@entitykit/core';
import { awaitWithOperationCancellation } from '@entitykit/core/adapter';

describe('cancellation of already-started promises', () => {
    it('observes a rejected operation when its signal was already aborted', async () => {
        const controller = new AbortController();
        controller.abort('deadline');
        const operation = Promise.reject(new Error('late driver failure'));

        await expect(awaitWithOperationCancellation(operation, controller.signal))
            .rejects.toMatchObject({ name: 'OperationCanceledError', cause: 'deadline' });
        await new Promise<void>(resolve => setImmediate(resolve));
    });

    it('observes rejection after cancellation has already reached the caller', async () => {
        const controller = new AbortController();
        let fail!: (reason: Error) => void;
        const operation: Promise<never> = new Promise((_resolve, reject) => {
            fail = reject;
        });
        const pending = awaitWithOperationCancellation(operation, controller.signal);
        controller.abort('deadline');

        await expect(pending).rejects.toBeInstanceOf(OperationCanceledError);
        fail(new Error('late driver failure'));
        await new Promise<void>(resolve => setImmediate(resolve));
    });

    it('preserves a successful operation without a cancellation signal', async () => {
        await expect(awaitWithOperationCancellation(Promise.resolve(42))).resolves.toBe(42);
    });

    it('preserves the original operation failure before cancellation', async () => {
        const failure = new Error('driver failure');
        const controller = new AbortController();
        await expect(awaitWithOperationCancellation(Promise.reject(failure), controller.signal))
            .rejects.toBe(failure);
    });

    it('removes the abort listener after successful work transfers its result', async () => {
        const controller = new AbortController();
        const remove = jest.spyOn(controller.signal, 'removeEventListener');
        await expect(awaitWithOperationCancellation(Promise.resolve(42), controller.signal)).resolves.toBe(42);
        expect(remove).toHaveBeenCalledTimes(1);
        controller.abort('after result transfer');
        expect(remove).toHaveBeenCalledTimes(1);
    });

    it('wraps a non-Error rejection while retaining the original cause', async () => {
        const controller = new AbortController();
        const reason = { driverStatus: 'disconnected' };
        // A third-party driver can reject with an arbitrary value.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        await expect(awaitWithOperationCancellation(Promise.reject(reason), controller.signal)).rejects.toMatchObject({
            message: 'The database operation failed.', cause: reason,
        });
    });
});
