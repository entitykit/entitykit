import { runInNewContext } from 'node:vm';
import { setFlagsFromString } from 'node:v8';
import { OperationCanceledError } from '../packages/core/src';
import { SqliteDatabaseConnection } from '../packages/sqlite/src/sqlite-database-connection';

describe('SQLite query stream cancellation', () => {
    it('checks cancellation before advancing the synchronous row iterator', async () => {
        const connection = new SqliteDatabaseConnection(':memory:');
        try {
            const controller = new AbortController();
            const rows = connection.stream<{ value: string; parsed: number }>({
                text: `select value, json_extract(value, '$.valid') as parsed
                    from (
                        select '{"valid":1}' as value
                        union all
                        select 'not json'
                    )`,
                values: [],
            }, { signal: controller.signal });
            const iterator = rows[Symbol.asyncIterator]();

            await expect(iterator.next()).resolves.toMatchObject({
                done: false,
                value: { value: '{"valid":1}', parsed: 1 },
            });

            controller.abort('stop before advancing');
            await expect(iterator.next()).rejects.toBeInstanceOf(
                OperationCanceledError,
            );

            await expect(connection.query({ text: 'select 1', values: [] }))
                .resolves.toMatchObject({ rowCount: 1 });
        } finally {
            await connection.dispose();
        }
    });

    it('retains the prepared statement across garbage collection between rows', async () => {
        const connection = new SqliteDatabaseConnection(':memory:');
        try {
            const rows = connection.stream<{ value: number }>({
                text: 'select 1 as value union all select 2 as value',
                values: [],
            });
            const iterator = rows[Symbol.asyncIterator]();

            await expect(iterator.next()).resolves.toMatchObject({
                done: false,
                value: { value: 1 },
            });

            forceGarbageCollection();

            await expect(iterator.next()).resolves.toMatchObject({
                done: false,
                value: { value: 2 },
            });
            await iterator.return(undefined);
        } finally {
            await connection.dispose();
        }
    });
});

function forceGarbageCollection(): void {
    setFlagsFromString('--expose-gc');
    try {
        const collect = runInNewContext('gc') as () => void;
        for (let index = 0; index < 5; index++) {
            collect();
        }
    } finally {
        setFlagsFromString('--no-expose-gc');
    }
}
