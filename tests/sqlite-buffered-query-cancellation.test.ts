import { OperationCanceledError } from '../packages/core/src';
import { SqliteDatabaseConnection } from '../packages/sqlite/src/sqlite-database-connection';

describe('SQLite buffered query cancellation', () => {
    it('rejects an already-canceled statement before execution', async () => {
        const connection = new SqliteDatabaseConnection(':memory:');
        const controller = new AbortController();
        controller.abort('stop query');

        await expect(connection.query(
            { text: 'create table should_not_exist (id text)', values: [] },
            { signal: controller.signal },
        )).rejects.toBeInstanceOf(OperationCanceledError);

        const result = await connection.query<{ count: number }>({
            text: 'select count(*) as count from sqlite_master where name = \'should_not_exist\'',
            values: [],
        });
        expect(result.rows[0]?.count).toBe(0);
        await connection.dispose();
    });

    it('observes cancellation before commit and rolls back the transaction', async () => {
        const connection = new SqliteDatabaseConnection(':memory:');
        const controller = new AbortController();
        await connection.query({
            text: 'create table cancellation_rows (id text primary key)',
            values: [],
        });

        await expect(connection.transaction(async () => {
            await connection.query({
                text: 'insert into cancellation_rows (id) values (?)',
                values: ['row_1'],
            });
            controller.abort('stop transaction');
        }, { signal: controller.signal })).rejects.toBeInstanceOf(
            OperationCanceledError,
        );

        const result = await connection.query<{ count: number }>({
            text: 'select count(*) as count from cancellation_rows',
            values: [],
        });
        expect(result.rows[0]?.count).toBe(0);
        await connection.dispose();
    });
});
