import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createSqliteDataSource, SqliteDatabaseConnection } from '../packages/sqlite/src';
import type { DatabaseConnection, EntityKitDataSource, SqliteConnectionConfig } from '../packages/sqlite/src';
import { createManagedTempDirectory } from './support/managed-temp-directory';

const select = { text: 'select 1 as value', values: [] };
// Retain the original method to invoke with the explicit native receiver below.
// eslint-disable-next-line @typescript-eslint/unbound-method
const realDispose = SqliteDatabaseConnection.prototype.dispose;

describe('SQLite retained connection retirement', () => {
    let source: EntityKitDataSource<SqliteConnectionConfig>;
    let query: jest.SpyInstance;
    let close: jest.SpyInstance;
    const leases: DatabaseConnection[] = [];

    beforeEach(() => {
        const filename = join(createManagedTempDirectory('entitykit-retire-'), 'app.db');
        const setup = new DatabaseSync(filename);
        setup.exec('create table rows (id integer primary key)');
        setup.exec('create table parents (id integer primary key)');
        setup.exec('create table children (id integer primary key, parent_id integer references parents(id))');
        setup.close();
        source = createSqliteDataSource({ filename, foreignKeys: true }, { maxIdleConnections: 2 });
        query = jest.spyOn(SqliteDatabaseConnection.prototype, 'query');
        close = jest.spyOn(SqliteDatabaseConnection.prototype, 'dispose');
    });

    afterEach(async () => {
        for (const lease of leases.splice(0)) await lease.dispose?.();
        await source.dispose();
        jest.restoreAllMocks();
    });

    function lease(): DatabaseConnection {
        const connection = source.createConnection();
        leases.push(connection);
        return connection;
    }

    async function native(connection: DatabaseConnection): Promise<unknown> {
        await connection.query(select);
        return query.mock.contexts.at(-1);
    }

    it.each([
        'pragma foreign_keys = off',
        'select 1; pragma foreign_keys = off',
        'create temp table temporary (id integer)',
        'attach database \':memory:\' as extra',
        'begin',
        '-- leading comment\nselect 1',
    ])('retires a handle after session-changing or unclassified SQL: %s', async text => {
        const first = lease();
        const before = await native(first);
        await first.query({ text, values: [] });
        await first.dispose?.();
        expect(close.mock.contexts).toEqual([before]);
        const second = lease();
        expect(await native(second)).not.toBe(before);
        expect((await second.query({ text: 'pragma foreign_keys', values: [] })).rows).toEqual([{ foreign_keys: 1 }]);
        expect((await second.query({ text: 'select count(*) as n from sqlite_temp_schema', values: [] })).rows).toEqual([{ n: 0 }]);
        expect((await second.query({ text: 'pragma database_list', values: [] })).rows.map(row => row.name)).not.toContain('extra');
    });

    it.each([
        ['query', 'EXPLAIN'],
        ['query', 'EXPLAIN QUERY PLAN'],
        ['stream', 'EXPLAIN'],
        ['stream', 'EXPLAIN QUERY PLAN'],
    ] as const)('preserves the next lease foreign keys after %s executes %s PRAGMA', async (mode, prefix) => {
        const first = lease();
        const before = await native(first);
        const statement = { text: `${prefix} PRAGMA foreign_keys = OFF`, values: [] };
        if (mode === 'query') await first.query(statement);
        else {
            const stream = first.stream?.(statement);
            if (!stream) throw new Error('SQLite stream missing');
            for await (const row of stream) expect(row).toBeDefined();
        }
        await first.dispose?.();

        const second = lease();
        await expect(second.query({ text: 'insert into children values (1, 999)', values: [] }))
            .rejects.toThrow('FOREIGN KEY constraint failed');
        expect((await second.query({ text: 'select * from children', values: [] })).rows).toEqual([]);
        await second.query({ text: 'insert into parents values (999)', values: [] });
        await second.query({ text: 'insert into children values (1, 999)', values: [] });
        expect((await second.query({ text: 'select * from children', values: [] })).rows)
            .toEqual([{ id: 1, parent_id: 999 }]);
        expect(close.mock.contexts).toEqual([before]);
        expect(await native(second)).not.toBe(before);
    });

    it('closes and rolls back a raw transaction before the next borrower', async () => {
        const first = lease();
        await first.query({ text: 'begin', values: [] });
        await first.query({ text: 'insert into rows values (1)', values: [] });
        await first.dispose?.();
        expect((await lease().query({ text: 'select * from rows', values: [] })).rows).toEqual([]);
    });

    it('retires a failed query rather than exposing a possibly changed session', async () => {
        const first = lease();
        const before = await native(first);
        await expect(first.query({ text: 'select missing from rows', values: [] })).rejects.toThrow('no such column');
        await first.dispose?.();
        expect(close.mock.contexts).toEqual([before]);
        expect(await native(lease())).not.toBe(before);
    });

    it.each(['query', 'stream'] as const)('executes the captured SQL text for %s when a getter changes its value', async mode => {
        const first = lease();
        const before = await native(first);
        let reads = 0;
        const statement = {
            get text(): string {
                return ++reads === 1 ? 'select 1 as value' : 'pragma foreign_keys = off';
            },
            values: [],
        };
        if (mode === 'query') expect((await first.query(statement)).rows).toEqual([{ value: 1 }]);
        else {
            const rows = [];
            for await (const row of first.stream?.(statement) ?? []) rows.push(row);
            expect(rows).toEqual([{ value: 1 }]);
        }
        expect(reads).toBe(1);
        await first.dispose?.();
        expect(await native(lease())).toBe(before);
    });

    it('retires failed transactions and sessions after preserving rollback', async () => {
        for (const mode of ['transaction', 'session'] as const) {
            const first = lease();
            const before = await native(first);
            await expect(first[mode]?.(async () => {
                if (mode === 'transaction') await first.query({ text: 'insert into rows values (1)', values: [] });
                throw new Error('application failed');
            })).rejects.toThrow('application failed');
            await first.dispose?.();
            expect(close.mock.contexts).toContain(before);
            const second = lease();
            expect(await native(second)).not.toBe(before);
            expect((await second.query({ text: 'select * from rows', values: [] })).rows).toEqual([]);
            await second.dispose?.();
        }
    });

    it('retires a failed row stream', async () => {
        const first = lease();
        const before = await native(first);
        const stream = first.stream?.({ text: 'select missing from rows', values: [] });
        if (!stream) throw new Error('SQLite stream missing');
        await expect(stream[Symbol.asyncIterator]().next()).rejects.toThrow('no such column');
        await first.dispose?.();
        expect(close.mock.contexts).toEqual([before]);
        expect(await native(lease())).not.toBe(before);
    });

    it('retains ordinary DML, CTEs and literals with quoted semicolons', async () => {
        const first = lease();
        const before = await native(first);
        for (const text of [
            'insert into rows values (1)',
            'update rows set id = 2 where id = 1',
            'with ids as (select id from rows) select * from ids',
            'select \';\' as value',
            ' \n\t SELECT 1 as value',
            'delete from rows',
        ]) await first.query({ text, values: [] });
        await first.dispose?.();
        expect(close).not.toHaveBeenCalled();
        expect(await native(lease())).toBe(before);
    });

    it.each([0, 1])('attempts every idle close when close %s reports failure', async failureIndex => {
        const first = lease();
        const second = lease();
        await first.dispose?.();
        await second.dispose?.();
        const failure = new Error('close reported failure');
        let closeIndex = 0;
        close.mockImplementation(async function (this: SqliteDatabaseConnection): Promise<void> {
            const index = closeIndex++;
            await realDispose.call(this);
            if (index === failureIndex) throw failure;
        });
        const failedSource = source;
        source = createSqliteDataSource(':memory:');
        await expect(failedSource.dispose()).rejects.toBe(failure);
        await expect(failedSource.dispose()).rejects.toBe(failure);
        expect(close).toHaveBeenCalledTimes(2);
        expect(() => failedSource.createConnection()).toThrow('was disposed');
    });
});
