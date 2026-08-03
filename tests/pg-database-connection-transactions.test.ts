import {
    PostgresDatabaseConnection,
    createPgClient,
    pgPool,
    resetPgConnectionMocks,
} from './support/pg-database-connection-test-support';
import { containing } from './support/jest-asymmetric-matchers';

describe('PostgresDatabaseConnection transactions', () => {
    beforeEach(resetPgConnectionMocks);

    it('wraps connection failures before starting a transaction', async () => {
        const connection = new PostgresDatabaseConnection({ connectionString: 'postgres://localhost/entitykit' });
        pgPool().connect.mockRejectedValueOnce({ code: 'ECONNREFUSED' });

        await expect(connection.transaction(() => 'never'))
            .rejects.toMatchObject({ name: 'DatabaseProviderError', operation: 'connect', code: 'ECONNREFUSED' });
        expect(connection.isInTransaction).toBe(false);
    });

    it('commits and releases successful transactions', async () => {
        const connection = new PostgresDatabaseConnection('postgres://localhost/entitykit');
        const pgClient = createPgClient();
        pgPool().connect.mockResolvedValueOnce(pgClient);

        await expect(connection.transaction(async () => {
            await connection.query({ text: 'select $1', values: [1] });
            return 'ok';
        })).resolves.toBe('ok');

        expect(pgClient.query.mock.calls).toEqual([
            ['begin'],
            ['select $1', [1]],
            ['commit'],
        ]);
        expect(pgClient.release).toHaveBeenCalledTimes(1);
        expect(connection.isInTransaction).toBe(false);
    });

    it('wraps begin failures and removes the unsafe client from the pool', async () => {
        const connection = new PostgresDatabaseConnection('postgres://localhost/entitykit');
        const pgClient = createPgClient();
        pgClient.query.mockRejectedValueOnce({ code: 'BEGIN_FAILED' });
        pgPool().connect.mockResolvedValueOnce(pgClient);

        await expect(connection.transaction(() => 'never'))
            .rejects.toMatchObject({ name: 'DatabaseProviderError', operation: 'begin', code: 'BEGIN_FAILED' });
        expect(pgClient.query.mock.calls).toEqual([['begin']]);
        expect(pgClient.release).toHaveBeenCalledWith(true);
    });

    it('wraps commit failures and releases the client after rollback', async () => {
        const connection = new PostgresDatabaseConnection('postgres://localhost/entitykit');
        const pgClient = createPgClient();
        pgClient.query.mockResolvedValueOnce(undefined);
        pgClient.query.mockRejectedValueOnce({ code: 'COMMIT_FAILED' });
        pgClient.query.mockResolvedValueOnce(undefined);
        pgPool().connect.mockResolvedValueOnce(pgClient);

        await expect(connection.transaction(() => 'ok'))
            .rejects.toMatchObject({ name: 'DatabaseProviderError', operation: 'commit', code: 'COMMIT_FAILED' });
        expect(pgClient.query.mock.calls).toEqual([['begin'], ['commit'], ['rollback']]);
        expect(pgClient.release).toHaveBeenCalledTimes(1);
    });

    it('poisons the connection when commit acknowledgement is lost', async () => {
        const connection = new PostgresDatabaseConnection('postgres://localhost/entitykit');
        const pgClient = createPgClient();
        pgClient.query.mockResolvedValueOnce(undefined);
        pgClient.query.mockRejectedValueOnce({ code: 'ECONNRESET' });
        pgClient.query.mockResolvedValueOnce(undefined);
        pgPool().connect.mockResolvedValueOnce(pgClient);

        await expect(connection.transaction(() => 'ok')).rejects.toMatchObject({
            name: 'TransactionOutcomeUnknownError',
            provider: 'postgres',
            operation: 'commit',
            retryable: false,
            commitError: containing({ code: 'ECONNRESET' }),
        });
        await expect(connection.query({ text: 'select 1', values: [] }))
            .rejects.toMatchObject({ name: 'TransactionOutcomeUnknownError' });

        expect(pgClient.query.mock.calls).toEqual([
            ['begin'],
            ['commit'],
            ['rollback'],
        ]);
        expect(pgClient.release).toHaveBeenCalledWith(true);
        expect(pgPool().connect).toHaveBeenCalledTimes(1);
    });

    it('surfaces rollback failures when work fails', async () => {
        const connection = new PostgresDatabaseConnection('postgres://localhost/entitykit');
        const pgClient = createPgClient();
        pgClient.query.mockResolvedValueOnce(undefined);
        pgClient.query.mockRejectedValueOnce({ code: 'ROLLBACK_FAILED' });
        pgPool().connect.mockResolvedValueOnce(pgClient);

        await expect(connection.transaction(() => {
            throw new Error('work failed');
        })).rejects.toMatchObject({
            name: 'DatabaseTransactionCleanupError',
            operation: 'rollback',
            primaryError: containing({ message: 'work failed' }),
            cleanupError: containing({
                name: 'DatabaseProviderError',
                operation: 'rollback',
                code: 'ROLLBACK_FAILED',
            }),
        });
        expect(pgClient.query.mock.calls).toEqual([['begin'], ['rollback']]);
        expect(pgClient.release).toHaveBeenCalledWith(true);
    });

    it('preserves commit failures when rollback cleanup also fails', async () => {
        const connection = new PostgresDatabaseConnection('postgres://localhost/entitykit');
        const pgClient = createPgClient();
        pgClient.query.mockResolvedValueOnce(undefined);
        pgClient.query.mockRejectedValueOnce({ code: 'COMMIT_FAILED' });
        pgClient.query.mockRejectedValueOnce({ code: 'ROLLBACK_FAILED' });
        pgPool().connect.mockResolvedValueOnce(pgClient);

        await expect(connection.transaction(() => 'ok'))
            .rejects.toMatchObject({
                name: 'DatabaseTransactionCleanupError',
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
        expect(pgClient.query.mock.calls).toEqual([['begin'], ['commit'], ['rollback']]);
        expect(pgClient.release).toHaveBeenCalledWith(true);
    });

    it('renders isolation and access options on the root transaction', async () => {
        const connection = new PostgresDatabaseConnection('postgres://localhost/entitykit');
        const pgClient = createPgClient();
        pgPool().connect.mockResolvedValueOnce(pgClient);

        await connection.transaction(
            () => 'ok',
            { isolationLevel: 'serializable', readOnly: true },
        );

        expect(pgClient.query.mock.calls).toEqual([
            ['begin isolation level serializable read only'],
            ['commit'],
        ]);
    });

    it('refuses to change transaction options inside a savepoint', async () => {
        const connection = new PostgresDatabaseConnection('postgres://localhost/entitykit');
        const pgClient = createPgClient();
        pgPool().connect.mockResolvedValueOnce(pgClient);

        await connection.transaction(async () => {
            await expect(connection.transaction(
                () => undefined,
                { isolationLevel: 'readCommitted' },
            )).rejects.toThrow('Nested Postgres transactions cannot change');
        });

        expect(pgClient.query.mock.calls).toEqual([['begin'], ['commit']]);
    });

    it('rejects unknown runtime isolation values before acquiring a client', async () => {
        const connection = new PostgresDatabaseConnection('postgres://localhost/entitykit');

        await expect(connection.transaction(
            () => undefined,
            { isolationLevel: 'snapshot' as never },
        )).rejects.toThrow('Unknown transaction isolation level \'snapshot\'');
        expect(pgPool().connect).not.toHaveBeenCalled();
    });
});
