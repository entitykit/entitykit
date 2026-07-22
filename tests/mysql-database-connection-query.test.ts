import {
    MySqlDatabaseConnection,
    mysqlPool,
    resetMysqlConnectionMocks,
} from './support/mysql-database-connection-test-support';

describe('MySqlDatabaseConnection queries', () => {
    beforeEach(resetMysqlConnectionMocks);

    it('binds structured values and returns rows from pool queries', async () => {
        const connection = new MySqlDatabaseConnection('mysql://localhost/entitykit');
        const createdAt = new Date('2026-07-29T12:34:56.789Z');
        mysqlPool().query.mockResolvedValueOnce([[{ id: 'usr_1' }], []]);

        await expect(connection.query<{ id: string }>({
            text: 'select * from `users` where `profile` = ? and `created_at` = ?',
            values: [{ role: 'admin' }, createdAt],
        })).resolves.toEqual({
            rows: [{ id: 'usr_1' }],
            rowCount: 1,
        });

        expect(mysqlPool().query).toHaveBeenCalledWith(
            'select * from `users` where `profile` = ? and `created_at` = ?',
            ['{"role":"admin"}', createdAt],
        );
    });

    it('returns affected rows and wraps query failures with statement context', async () => {
        const connection = new MySqlDatabaseConnection('mysql://localhost/entitykit');
        mysqlPool().query.mockResolvedValueOnce([{ affectedRows: 3 }, []]);

        await expect(connection.query({
            text: 'update `users` set `active` = ?',
            values: [true],
        })).resolves.toEqual({ rows: [], rowCount: 3 });

        const cause = {
            code: 'ER_DUP_ENTRY',
            sqlMessage: 'Duplicate entry \'a@example.com\' for key \'users.ux_users_email\'',
        };
        const statement = {
            text: 'insert into `users` (`email`) values (?)',
            values: ['a@example.com'],
        };
        mysqlPool().query.mockRejectedValueOnce(cause);

        await expect(connection.query(statement)).rejects.toMatchObject({
            name: 'DatabaseProviderError',
            provider: 'mysql',
            operation: 'query',
            code: 'ER_DUP_ENTRY',
            table: 'users',
            constraint: 'users.ux_users_email',
            statement,
        });
    });

    it('wraps dispose failures', async () => {
        const connection = new MySqlDatabaseConnection('mysql://localhost/entitykit');
        mysqlPool().end.mockRejectedValueOnce({
            code: 'DISPOSE_FAILED',
            sqlMessage: 'pool failed',
        });

        await expect(connection.dispose()).rejects.toMatchObject({
            name: 'DatabaseProviderError',
            provider: 'mysql',
            operation: 'dispose',
            code: 'DISPOSE_FAILED',
        });
    });
});
