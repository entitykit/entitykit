import { acquireWithOperationCancellation } from '@entitykit/core/adapter';
import type { MySqlConnection, MySqlPool } from './mysql-driver';
import { createMysqlProviderError } from './mysql-provider-error';

export async function acquireMysqlConnection(
    pool: MySqlPool,
    signal?: AbortSignal,
): Promise<MySqlConnection> {
    return acquireWithOperationCancellation(
        async () => {
            try {
                return await pool.getConnection();
            } catch (error) {
                throw createMysqlProviderError('connect', error);
            }
        },
        connection => {
            connection.release();
        },
        signal,
    );
}
