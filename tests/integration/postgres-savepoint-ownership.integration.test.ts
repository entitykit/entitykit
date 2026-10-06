import { PostgresDatabaseConnection } from '../../packages/postgres/src';
import { requireDefined } from '../support/require-defined';

const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
const live = process.env.RUN_POSTGRES_TESTS === 'true' && Boolean(url) ? describe : describe.skip;

live('Postgres recovered savepoint ownership', () => {
    it('repeatedly rolls back, releases and continues one live outer transaction', async () => {
        const connection = new PostgresDatabaseConnection(requireDefined(url));
        const query = async (text: string): Promise<void> => {
            await connection.query({ text, values: [] });
        };
        try {
            await connection.transaction(async () => {
                await query('create temporary table savepoint_items (id integer primary key) on commit drop');
                for (let index = 0; index < 20; index += 1) {
                    const failure = new Error(`item ${String(index)} failed`);
                    await expect(connection.transaction(async () => {
                        await connection.query({ text: 'insert into savepoint_items values ($1)', values: [index] });
                        throw failure;
                    })).rejects.toBe(failure);
                    // An absent savepoint raises 3B001. The test-owned probe scope
                    // recovers that expected server error without ending the root.
                    await query('savepoint ownership_probe');
                    await expect(query('release savepoint entitykit_sp_1'))
                        .rejects.toMatchObject({ code: '3B001' });
                    await query('rollback to savepoint ownership_probe');
                    await query('release savepoint ownership_probe');
                    expect((await connection.query({ text: 'select * from savepoint_items', values: [] })).rows).toEqual([]);
                }
                await connection.transaction(async () => {
                    await query('insert into savepoint_items values (100)');
                });
                expect((await connection.query({ text: 'select * from savepoint_items', values: [] })).rows)
                    .toEqual([{ id: 100 }]);
            });
            expect(connection.isInTransaction).toBe(false);
            expect((await connection.query({ text: 'select 1 as usable', values: [] })).rows).toEqual([{ usable: 1 }]);
        } finally {
            await connection.dispose();
        }
    });
});
