import { invokeDetachedObserver } from '../../diagnostics/detached-observer';

interface PostgresPoolErrorEmitter {
    on(event: 'error', listener: (error: Error) => void): unknown;
}

export function observePostgresPoolErrors<
    TPool extends PostgresPoolErrorEmitter,
>(
    pool: TPool,
    onError?: (error: Error) => void | Promise<void>,
): TPool {
    pool.on('error', error => {
        if (onError) {
            invokeDetachedObserver(
                (): void | Promise<void> => onError(error),
            );
            return;
        }
        process.emitWarning(
            'An idle Postgres pool client failed and was removed. Configure pool.onError to observe the original error.',
            { code: 'ENTITYKIT_POSTGRES_POOL_ERROR' },
        );
    });
    return pool;
}
