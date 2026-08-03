import {
    MySqlDatabaseConnection,
    createMysqlClient,
    mysqlPool,
    resetMysqlConnectionMocks,
} from './support/mysql-database-connection-test-support';
import { containing } from './support/jest-asymmetric-matchers';

describe('MySqlDatabaseConnection transactions', () => {
    beforeEach(resetMysqlConnectionMocks);

    it('commits successful work on one checked-out connection', async () => {
        const connection = new MySqlDatabaseConnection({ connectionString: 'mysql://localhost/entitykit' });
        const mysqlClient = createMysqlClient();
        mysqlClient.query.mockResolvedValueOnce([[], []]);
        mysqlClient.query.mockResolvedValueOnce([[{ value: 1 }], []]);
        mysqlClient.query.mockResolvedValueOnce([[], []]);
        mysqlPool().getConnection.mockResolvedValueOnce(mysqlClient);

        await expect(connection.transaction(async () => {
            expect(connection.isInTransaction).toBe(true);
            return connection.query<{ value: number }>({
                text: 'select ? as `value`',
                values: [1],
            });
        })).resolves.toEqual({
            rows: [{ value: 1 }],
            rowCount: 1,
        });

        expect(mysqlClient.query.mock.calls).toEqual([
            ['begin', []],
            ['select ? as `value`', [1]],
            ['commit', []],
        ]);
        expect(mysqlPool().query).not.toHaveBeenCalled();
        expect(mysqlClient.release).toHaveBeenCalledTimes(1);
        expect(connection.isInTransaction).toBe(false);
    });

    it('normalizes connection checkout failures before starting a transaction', async () => {
        const connection = new MySqlDatabaseConnection('mysql://localhost/entitykit');
        const cause = {
            code: 'ECONNREFUSED',
            sqlMessage: 'connect refused',
        };
        mysqlPool().getConnection.mockRejectedValueOnce(cause);

        await expect(connection.transaction(() => 'never')).rejects.toMatchObject({
            name: 'DatabaseProviderError',
            provider: 'mysql',
            operation: 'connect',
            code: 'ECONNREFUSED',
            detail: 'connect refused',
            cause,
        });

        expect(connection.isInTransaction).toBe(false);
        expect(mysqlPool().query).not.toHaveBeenCalled();
    });

    it('destroys a connection whose transaction could not begin', async () => {
        const connection = new MySqlDatabaseConnection('mysql://localhost/entitykit');
        const mysqlClient = createMysqlClient();
        mysqlClient.query.mockRejectedValueOnce({
            code: 'BEGIN_FAILED',
            sqlMessage: 'begin failed',
        });
        mysqlPool().getConnection.mockResolvedValueOnce(mysqlClient);

        await expect(connection.transaction(() => 'never')).rejects.toMatchObject({
            name: 'DatabaseProviderError',
            operation: 'begin',
            code: 'BEGIN_FAILED',
        });

        expect(mysqlClient.destroy).toHaveBeenCalledTimes(1);
        expect(mysqlClient.release).not.toHaveBeenCalled();
    });

    it('rolls back failed work and restores connection state', async () => {
        const connection = new MySqlDatabaseConnection('mysql://localhost/entitykit');
        const mysqlClient = createMysqlClient();
        mysqlPool().getConnection.mockResolvedValueOnce(mysqlClient);

        await expect(connection.transaction(() => {
            throw new Error('work failed');
        })).rejects.toThrow('work failed');

        expect(mysqlClient.query.mock.calls).toEqual([
            ['begin', []],
            ['rollback', []],
        ]);
        expect(mysqlClient.destroy).not.toHaveBeenCalled();
        expect(mysqlClient.release).toHaveBeenCalledTimes(1);
        expect(connection.isInTransaction).toBe(false);
    });

    it('destroys the connection when commit and rollback both fail', async () => {
        const connection = new MySqlDatabaseConnection('mysql://localhost/entitykit');
        const mysqlClient = createMysqlClient();
        mysqlClient.query
            .mockResolvedValueOnce([[], []])
            .mockRejectedValueOnce({
                code: 'COMMIT_FAILED',
                sqlMessage: 'commit failed',
            })
            .mockRejectedValueOnce({
                code: 'ROLLBACK_FAILED',
                sqlMessage: 'connection lost',
            });
        mysqlPool().getConnection.mockResolvedValueOnce(mysqlClient);

        await expect(connection.transaction(() => 'ok'))
            .rejects.toMatchObject({
                name: 'DatabaseTransactionCleanupError',
                provider: 'mysql',
                operation: 'rollback',
                primaryError: containing({
                    name: 'DatabaseProviderError',
                    operation: 'commit',
                    code: 'COMMIT_FAILED',
                }),
                cleanupError: containing({
                    name: 'DatabaseProviderError',
                    operation: 'rollback',
                    code: 'ROLLBACK_FAILED',
                }),
            });

        expect(mysqlClient.query.mock.calls).toEqual([
            ['begin', []],
            ['commit', []],
            ['rollback', []],
        ]);
        expect(mysqlClient.destroy).toHaveBeenCalledTimes(1);
        expect(mysqlClient.release).not.toHaveBeenCalled();
        expect(connection.isInTransaction).toBe(false);
    });

    it('rolls back a failed commit and preserves the commit error', async () => {
        const connection = new MySqlDatabaseConnection('mysql://localhost/entitykit');
        const mysqlClient = createMysqlClient();
        mysqlClient.query
            .mockResolvedValueOnce([[], []])
            .mockRejectedValueOnce({
                code: 'COMMIT_FAILED',
                sqlMessage: 'commit failed',
            })
            .mockResolvedValueOnce([[], []]);
        mysqlPool().getConnection.mockResolvedValueOnce(mysqlClient);

        await expect(connection.transaction(() => 'ok')).rejects.toMatchObject({
            name: 'DatabaseProviderError',
            provider: 'mysql',
            operation: 'commit',
            code: 'COMMIT_FAILED',
        });

        expect(mysqlClient.query.mock.calls).toEqual([
            ['begin', []],
            ['commit', []],
            ['rollback', []],
        ]);
        expect(mysqlClient.destroy).not.toHaveBeenCalled();
        expect(mysqlClient.release).toHaveBeenCalledTimes(1);
        expect(connection.isInTransaction).toBe(false);
    });

    it('poisons the connection when commit acknowledgement is lost', async () => {
        const connection = new MySqlDatabaseConnection('mysql://localhost/entitykit');
        const mysqlClient = createMysqlClient();
        mysqlClient.query
            .mockResolvedValueOnce([[], []])
            .mockRejectedValueOnce({
                code: 'PROTOCOL_CONNECTION_LOST',
                sqlMessage: 'connection lost',
            })
            .mockResolvedValueOnce([[], []]);
        mysqlPool().getConnection.mockResolvedValueOnce(mysqlClient);

        await expect(connection.transaction(() => 'ok')).rejects.toMatchObject({
            name: 'TransactionOutcomeUnknownError',
            provider: 'mysql',
            operation: 'commit',
            retryable: false,
            commitError: containing({ code: 'PROTOCOL_CONNECTION_LOST' }),
        });
        await expect(connection.query({ text: 'select 1', values: [] }))
            .rejects.toMatchObject({ name: 'TransactionOutcomeUnknownError' });

        expect(mysqlClient.query.mock.calls).toEqual([
            ['begin', []],
            ['commit', []],
            ['rollback', []],
        ]);
        expect(mysqlClient.destroy).toHaveBeenCalledTimes(1);
        expect(mysqlClient.release).not.toHaveBeenCalled();
        expect(mysqlPool().getConnection).toHaveBeenCalledTimes(1);
    });

    it('preserves the primary failure when rollback cleanup also fails', async () => {
        const connection = new MySqlDatabaseConnection('mysql://localhost/entitykit');
        const mysqlClient = createMysqlClient();
        mysqlClient.query.mockResolvedValueOnce([[], []]);
        mysqlClient.query.mockRejectedValueOnce({
            code: 'ROLLBACK_FAILED',
            sqlMessage: 'connection lost',
        });
        mysqlPool().getConnection.mockResolvedValueOnce(mysqlClient);

        await expect(connection.transaction(() => {
            throw new Error('work failed');
        })).rejects.toMatchObject({
            name: 'DatabaseTransactionCleanupError',
            provider: 'mysql',
            operation: 'rollback',
            primaryError: containing({ message: 'work failed' }),
            cleanupError: containing({
                name: 'DatabaseProviderError',
                operation: 'rollback',
                code: 'ROLLBACK_FAILED',
            }),
        });

        expect(mysqlClient.query.mock.calls).toEqual([
            ['begin', []],
            ['rollback', []],
        ]);
        expect(mysqlClient.destroy).toHaveBeenCalledTimes(1);
        expect(mysqlClient.release).not.toHaveBeenCalled();
        expect(connection.isInTransaction).toBe(false);
    });

    it('sets isolation and read-only mode before transaction work', async () => {
        const connection = new MySqlDatabaseConnection('mysql://localhost/entitykit');
        const mysqlClient = createMysqlClient();
        mysqlPool().getConnection.mockResolvedValueOnce(mysqlClient);

        await connection.transaction(
            () => 'ok',
            { isolationLevel: 'repeatableRead', readOnly: true },
        );

        expect(mysqlClient.query.mock.calls).toEqual([
            ['set transaction isolation level repeatable read', []],
            ['start transaction read only', []],
            ['commit', []],
        ]);
    });

    it('refuses to change transaction options inside a savepoint', async () => {
        const connection = new MySqlDatabaseConnection('mysql://localhost/entitykit');
        const mysqlClient = createMysqlClient();
        mysqlPool().getConnection.mockResolvedValueOnce(mysqlClient);

        await connection.transaction(async () => {
            await expect(connection.transaction(
                () => undefined,
                { readOnly: true },
            )).rejects.toThrow('Nested MySQL transactions cannot change');
        });

        expect(mysqlClient.query.mock.calls).toEqual([
            ['begin', []],
            ['commit', []],
        ]);
    });
});
