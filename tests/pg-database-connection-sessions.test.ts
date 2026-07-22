import {
    PostgresDatabaseConnection,
    createPgClient,
    pgPool,
    resetPgConnectionMocks,
} from './support/pg-database-connection-test-support';

describe('PostgresDatabaseConnection sessions', () => {
    beforeEach(resetPgConnectionMocks);

    it('destroys a failed pinned session so advisory locks cannot leak', async () => {
        const connection = new PostgresDatabaseConnection('postgres://localhost/entitykit');
        const pgClient = createPgClient();
        pgClient.query.mockResolvedValueOnce({ rows: [{ value: 1 }], rowCount: 1 });
        pgPool().connect.mockResolvedValueOnce(pgClient);

        await expect(connection.session(async () => {
            await connection.query({ text: 'select value', values: [] });
            throw new Error('session failed');
        })).rejects.toThrow('session failed');

        expect(pgClient.query).toHaveBeenCalledWith('select value', []);
        expect(pgPool().query).not.toHaveBeenCalled();
        expect(pgClient.release).toHaveBeenCalledWith(true);
    });
});
