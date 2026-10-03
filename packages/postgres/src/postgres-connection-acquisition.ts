import { acquireWithOperationCancellation } from '@entitykit/core/adapter';
import type { Pool, PoolClient } from './postgres-driver';
import { createPostgresProviderError } from './postgres-provider-error';
import { retainPostgresClient } from './postgres-client-lease';

export async function acquirePostgresConnection(
    pool: Pool,
    signal?: AbortSignal,
): Promise<PoolClient> {
    return acquireWithOperationCancellation(
        async () => {
            try {
                return retainPostgresClient(await pool.connect());
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
