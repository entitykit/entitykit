import {
    PostgresDatabaseConnection,
    pgPool,
    resetPgConnectionMocks,
} from './support/pg-database-connection-test-support';

describe('PostgresDatabaseConnection queries and lifecycle', () => {
    beforeEach(resetPgConnectionMocks);

    it('wraps pool query failures with statement context', async () => {
        const connection = new PostgresDatabaseConnection('postgres://localhost/entitykit');
        const cause = { code: '23505', constraint: 'ux_users_email' };
        pgPool().query.mockRejectedValueOnce(cause);

        await expect(connection.query({ text: 'insert into "users" values ($1)', values: ['usr_1'] }))
            .rejects.toMatchObject({
                name: 'DatabaseProviderError',
                operation: 'query',
                code: '23505',
                constraint: 'ux_users_email',
                statement: { text: 'insert into "users" values ($1)', values: ['usr_1'] },
            });
    });

    it('wraps query failures after dispose with statement context', async () => {
        const connection = new PostgresDatabaseConnection('postgres://localhost/entitykit');
        pgPool().end.mockResolvedValueOnce(undefined);
        pgPool().query.mockRejectedValueOnce({ code: 'POOL_CLOSED' });

        await connection.dispose();
        await expect(connection.query({ text: 'select after dispose', values: [] }))
            .rejects.toMatchObject({
                name: 'DatabaseProviderError',
                operation: 'query',
                code: 'POOL_CLOSED',
                statement: { text: 'select after dispose', values: [] },
            });
    });

    it('wraps dispose failures', async () => {
        const connection = new PostgresDatabaseConnection('postgres://localhost/entitykit');
        pgPool().end.mockRejectedValueOnce({ code: 'DISPOSE_FAILED' });

        await expect(connection.dispose())
            .rejects.toMatchObject({ name: 'DatabaseProviderError', operation: 'dispose', code: 'DISPOSE_FAILED' });
    });
});
