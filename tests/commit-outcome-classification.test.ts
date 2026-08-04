import {
    createMysqlClient,
    MySqlDatabaseConnection,
    mysqlPool,
    resetMysqlConnectionMocks,
} from './support/mysql-database-connection-test-support';
import {
    createPgClient,
    PostgresDatabaseConnection,
    pgPool,
    resetPgConnectionMocks,
} from './support/pg-database-connection-test-support';
import { containing } from './support/jest-asymmetric-matchers';

const sharedUncertainFailures: ReadonlyArray<readonly [string, unknown]> = [
    ['network unreachable', { code: 'ENETUNREACH' }],
    ['host unreachable', { code: 'EHOSTUNREACH' }],
    ['network down', { code: 'ENETDOWN' }],
    ['missing error code', new Error('commit failed')],
    ['non-error rejection', 'commit failed'],
];

describe('conservative commit outcome classification', () => {
    beforeEach(() => {
        resetPgConnectionMocks();
        resetMysqlConnectionMocks();
    });

    it.each([
        ...sharedUncertainFailures,
        ['protocol failure', { code: '08P01' }] as const,
    ])('poisons Postgres after %s even when rollback succeeds', async (
        _name,
        commitFailure,
    ) => {
        const connection = new PostgresDatabaseConnection(
            'postgres://localhost/entitykit',
        );
        const client = createPgClient();
        client.query
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(commitFailure)
            .mockResolvedValueOnce(undefined);
        pgPool().connect.mockResolvedValueOnce(client);

        await expect(connection.transaction(() => 'ok')).rejects.toMatchObject({
            name: 'TransactionOutcomeUnknownError',
            provider: 'postgres',
            operation: 'commit',
            retryable: false,
        });
        await expect(connection.query({ text: 'select 1', values: [] }))
            .rejects.toMatchObject({ name: 'TransactionOutcomeUnknownError' });
        expect(client.release).toHaveBeenCalledWith(true);
    });

    it.each([
        ...sharedUncertainFailures,
        ['protocol failure', { code: 'PROTOCOL_SEQUENCE_TIMEOUT' }] as const,
    ])('poisons MySQL after %s even when rollback succeeds', async (
        _name,
        commitFailure,
    ) => {
        const connection = new MySqlDatabaseConnection(
            'mysql://localhost/entitykit',
        );
        const client = createMysqlClient();
        client.query
            .mockResolvedValueOnce([[], []])
            .mockRejectedValueOnce(commitFailure)
            .mockResolvedValueOnce([[], []]);
        mysqlPool().getConnection.mockResolvedValueOnce(client);

        await expect(connection.transaction(() => 'ok')).rejects.toMatchObject({
            name: 'TransactionOutcomeUnknownError',
            provider: 'mysql',
            operation: 'commit',
            retryable: false,
        });
        await expect(connection.query({ text: 'select 1', values: [] }))
            .rejects.toMatchObject({ name: 'TransactionOutcomeUnknownError' });
        expect(client.destroy).toHaveBeenCalledTimes(1);
    });

    it('retains unknown Postgres durability beneath rollback cleanup failure', async () => {
        const connection = new PostgresDatabaseConnection(
            'postgres://localhost/entitykit',
        );
        const client = createPgClient();
        client.query
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce({ code: 'ENETUNREACH' })
            .mockRejectedValueOnce({ code: 'EHOSTUNREACH' });
        pgPool().connect.mockResolvedValueOnce(client);

        await expect(connection.transaction(() => 'ok')).rejects.toMatchObject({
            name: 'DatabaseTransactionCleanupError',
            primaryError: containing({ name: 'TransactionOutcomeUnknownError' }),
        });
        await expect(connection.query({ text: 'select 1', values: [] }))
            .rejects.toMatchObject({ name: 'TransactionOutcomeUnknownError' });
        expect(client.release).toHaveBeenCalledWith(true);
    });

    it('retains unknown MySQL durability beneath rollback cleanup failure', async () => {
        const connection = new MySqlDatabaseConnection(
            'mysql://localhost/entitykit',
        );
        const client = createMysqlClient();
        client.query
            .mockResolvedValueOnce([[], []])
            .mockRejectedValueOnce({ code: 'ENETUNREACH' })
            .mockRejectedValueOnce({ code: 'EHOSTUNREACH' });
        mysqlPool().getConnection.mockResolvedValueOnce(client);

        await expect(connection.transaction(() => 'ok')).rejects.toMatchObject({
            name: 'DatabaseTransactionCleanupError',
            primaryError: containing({ name: 'TransactionOutcomeUnknownError' }),
        });
        await expect(connection.query({ text: 'select 1', values: [] }))
            .rejects.toMatchObject({ name: 'TransactionOutcomeUnknownError' });
        expect(client.destroy).toHaveBeenCalledTimes(1);
    });
});
