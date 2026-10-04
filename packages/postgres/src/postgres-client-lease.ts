import type { PoolClient, PostgresQueryResult } from './postgres-driver-contract';

/** Own driver error events until the pool takes the checked-out client back. */
export function retainPostgresClient(client: PoolClient): PoolClient {
    let failure: Error | undefined;
    let released = false;
    const observeError = (error: Error): void => {
        failure ??= error;
    };
    const observesErrors = client.on !== undefined && client.removeListener !== undefined;
    if (observesErrors) {
        client.on?.('error', observeError);
    }
    return {
        async query<TRow extends Record<string, unknown>>(
            text: string,
            values?: readonly unknown[],
        ): Promise<PostgresQueryResult<TRow>> {
            if (released) {
                throw new Error('The checked-out Postgres client was released.');
            }
            if (failure) {
                throw failure;
            }
            return await client.query<TRow>(text, values);
        },
        release(error?: boolean | Error): void {
            if (released) {
                throw new Error('The checked-out Postgres client was released more than once.');
            }
            released = true;
            try {
                // Pool.release synchronously restores its own idle error listener.
                client.release(error === false ? failure : error ?? failure);
            } finally {
                if (observesErrors) {
                    client.removeListener?.('error', observeError);
                }
            }
        },
    };
}
