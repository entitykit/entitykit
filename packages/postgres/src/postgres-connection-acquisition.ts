import { acquireWithOperationCancellation } from '@entitykit/core/adapter';
import type { Pool, PoolClient } from './postgres-driver';
import { createPostgresProviderError } from './postgres-provider-error';

export async function acquirePostgresConnection(
    pool: Pool,
    signal?: AbortSignal,
): Promise<PoolClient> {
    return acquireWithOperationCancellation(
        async () => {
            try {
                return await pool.connect();
            } catch (error) {
                throw createPostgresProviderError('connect', error);
            }
        },
        client => {
            client.release();
        },
        signal,
    );
}
