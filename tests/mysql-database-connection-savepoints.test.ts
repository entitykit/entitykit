import {
    MySqlDatabaseConnection,
    createMysqlClient,
    mysqlPool,
    resetMysqlConnectionMocks,
} from './support/mysql-database-connection-test-support';
import { containing } from './support/jest-asymmetric-matchers';

describe('MySqlDatabaseConnection savepoints', () => {
    beforeEach(resetMysqlConnectionMocks);

    it('uses savepoints for nested transactions', async () => {
        const connection = new MySqlDatabaseConnection('mysql://localhost/entitykit');
        const mysqlClient = createMysqlClient();
        mysqlPool().getConnection.mockResolvedValueOnce(mysqlClient);

        await connection.transaction(async () => {
            await connection.transaction(async () => {
                await connection.query({ text: 'select nested', values: [] });
            });
        });

        expect(mysqlClient.query.mock.calls).toEqual([
            ['begin', []],
            ['savepoint entitykit_sp_1', []],
            ['select nested', []],
            ['release savepoint entitykit_sp_1', []],
            ['commit', []],
        ]);
        expect(mysqlClient.release).toHaveBeenCalledTimes(1);
    });

    it('rolls back a failed savepoint and keeps the outer transaction usable', async () => {
        const connection = new MySqlDatabaseConnection('mysql://localhost/entitykit');
        const mysqlClient = createMysqlClient();
        mysqlPool().getConnection.mockResolvedValueOnce(mysqlClient);

        await connection.transaction(async () => {
            await expect(connection.transaction(() => {
                throw new Error('nested failed');
            })).rejects.toThrow('nested failed');

            await connection.query({ text: 'select outer', values: [] });
        });

        expect(mysqlClient.query.mock.calls).toEqual([
            ['begin', []],
            ['savepoint entitykit_sp_1', []],
            ['rollback to savepoint entitykit_sp_1', []],
            ['select outer', []],
            ['commit', []],
        ]);
    });

    it('rolls back the root when application code catches a failed savepoint', async () => {
        const connection = new MySqlDatabaseConnection('mysql://localhost/entitykit');
        const mysqlClient = createMysqlClient();
        mysqlClient.query
            .mockResolvedValueOnce([[], []])
            .mockRejectedValueOnce({
                code: 'SAVEPOINT_FAILED',
                sqlMessage: 'savepoint failed',
            })
            .mockResolvedValueOnce([[], []]);
        mysqlPool().getConnection.mockResolvedValueOnce(mysqlClient);

        await expect(connection.transaction(async () => {
            await expect(connection.transaction(() => 'never'))
                .rejects.toMatchObject({ operation: 'savepoint' });
            return 'caught';
        })).rejects.toMatchObject({
            operation: 'savepoint',
            code: 'SAVEPOINT_FAILED',
        });

        expect(mysqlClient.query.mock.calls).toEqual([
            ['begin', []],
            ['savepoint entitykit_sp_1', []],
            ['rollback', []],
        ]);
    });

    it('rolls back to the savepoint after release fails', async () => {
        const connection = new MySqlDatabaseConnection('mysql://localhost/entitykit');
        const mysqlClient = createMysqlClient();
        mysqlClient.query
            .mockResolvedValueOnce([[], []])
            .mockResolvedValueOnce([[], []])
            .mockRejectedValueOnce({
                code: 'RELEASE_FAILED',
                sqlMessage: 'release failed',
            })
            .mockResolvedValueOnce([[], []]);
        mysqlPool().getConnection.mockResolvedValueOnce(mysqlClient);

        await expect(connection.transaction(async () => {
            await connection.transaction(() => 'ok');
        })).rejects.toMatchObject({
            name: 'DatabaseProviderError',
            provider: 'mysql',
            operation: 'releaseSavepoint',
            code: 'RELEASE_FAILED',
        });

        expect(mysqlClient.query.mock.calls).toEqual([
            ['begin', []],
            ['savepoint entitykit_sp_1', []],
            ['release savepoint entitykit_sp_1', []],
            ['rollback to savepoint entitykit_sp_1', []],
            ['rollback', []],
        ]);
    });

    it('preserves nested work failures when savepoint rollback cleanup fails', async () => {
        const connection = new MySqlDatabaseConnection('mysql://localhost/entitykit');
        const mysqlClient = createMysqlClient();
        mysqlClient.query
            .mockResolvedValueOnce([[], []])
            .mockResolvedValueOnce([[], []])
            .mockRejectedValueOnce({
                code: 'ROLLBACK_TO_SAVEPOINT_FAILED',
                sqlMessage: 'connection lost',
            })
            .mockResolvedValueOnce([[], []]);
        mysqlPool().getConnection.mockResolvedValueOnce(mysqlClient);

        await expect(connection.transaction(async () => {
            await connection.transaction(() => {
                throw new Error('nested failed');
            });
        })).rejects.toMatchObject({
            name: 'DatabaseTransactionCleanupError',
            provider: 'mysql',
            operation: 'rollbackToSavepoint',
            primaryError: containing({ message: 'nested failed' }),
            cleanupError: containing({
                name: 'DatabaseProviderError',
                operation: 'rollbackToSavepoint',
                code: 'ROLLBACK_TO_SAVEPOINT_FAILED',
            }),
        });

        expect(mysqlClient.query.mock.calls).toEqual([
            ['begin', []],
            ['savepoint entitykit_sp_1', []],
            ['rollback to savepoint entitykit_sp_1', []],
            ['rollback', []],
        ]);
    });
});
