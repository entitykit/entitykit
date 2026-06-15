import { OperationCanceledError } from '../errors/runtime-errors';

/** Throw EntityKit's stable cancellation error when the signal is aborted. */
export function throwIfOperationAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw new OperationCanceledError(signal.reason);
    }
}

/** Whether an operation's cancellation signal has been aborted. */
export function isOperationAborted(signal?: AbortSignal): boolean {
    return signal?.aborted === true;
}

/** Await work while allowing an owned provider resource to abort promptly. */
export async function awaitWithOperationCancellation<TResult>(
    operation: Promise<TResult>,
    signal?: AbortSignal,
): Promise<TResult> {
    throwIfOperationAborted(signal);
    if (!signal) {
        return operation;
    }

    return new Promise<TResult>((resolve, reject) => {
        const abort = (): void => {
            cleanup();
            reject(new OperationCanceledError(signal.reason));
        };
        const cleanup = (): void => {
            signal.removeEventListener('abort', abort);
        };
        signal.addEventListener('abort', abort, { once: true });
        operation.then(
            result => {
                cleanup();
                resolve(result);
            },
            (error: unknown) => {
                cleanup();
                reject(error instanceof Error
                    ? error
                    : new Error('The database operation failed.', { cause: error }));
            },
        );
    });
}
