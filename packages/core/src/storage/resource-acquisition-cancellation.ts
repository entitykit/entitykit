import { OperationCanceledError } from '../errors/runtime-errors';
import { throwIfOperationAborted } from './operation-cancellation';

/** Cancel a queued acquisition and release any resource delivered afterward. */
export async function acquireWithOperationCancellation<TResource>(
    acquire: () => Promise<TResource>,
    release: (resource: TResource) => void | Promise<void>,
    signal?: AbortSignal,
): Promise<TResource> {
    throwIfOperationAborted(signal);
    if (!signal) {
        return acquire();
    }

    return new Promise<TResource>((resolve, reject) => {
        let canceled = false;
        const cleanup = (): void => {
            signal.removeEventListener('abort', abort);
        };
        const abort = (): void => {
            canceled = true;
            cleanup();
            reject(new OperationCanceledError(signal.reason));
        };
        signal.addEventListener('abort', abort, { once: true });
        let pending: Promise<TResource>;
        try {
            pending = acquire();
        } catch (error) {
            cleanup();
            reject(error instanceof Error ? error : new Error('Resource acquisition failed.', { cause: error }));
            return;
        }
        pending.then(
            async resource => {
                cleanup();
                if (canceled) {
                    await release(resource);
                } else {
                    resolve(resource);
                }
            },
            (error: unknown) => {
                cleanup();
                reject(error instanceof Error ? error : new Error('Resource acquisition failed.', { cause: error }));
            },
        ).catch(() => {
            // The caller already received cancellation. Report failed late
            // cleanup without exposing driver credentials or abandoning a promise.
            process.emitWarning('Releasing a resource acquired after cancellation failed.', {
                code: 'ENTITYKIT_CANCELED_RESOURCE_CLEANUP',
            });
        });
    });
}
