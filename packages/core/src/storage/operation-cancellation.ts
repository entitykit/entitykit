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
        // Observe already-started work even when cancellation won before this
        // helper was called. Otherwise its rejection escapes the caller's catch.
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
        if (signal.aborted) {
            abort();
        } else {
            signal.addEventListener('abort', abort, { once: true });
        }
    });
}
