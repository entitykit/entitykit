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
});
