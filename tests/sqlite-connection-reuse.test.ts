import { join } from 'node:path';
import { createSqliteDataSource, SqliteDatabaseConnection } from '../packages/sqlite/src';
import type { DatabaseConnection, EntityKitDataSource, SqliteConnectionConfig } from '../packages/sqlite/src';
import { createManagedTempDirectory } from './support/managed-temp-directory';

const select = { text: 'select 1 as value', values: [] };

describe('opt-in SQLite connection reuse', () => {
    let filename: string;
    let source: EntityKitDataSource<SqliteConnectionConfig>;
    let query: jest.SpyInstance;
    let close: jest.SpyInstance;
    const leases: DatabaseConnection[] = [];

    beforeEach(() => {
        filename = join(createManagedTempDirectory('entitykit-reuse-'), 'app.db');
        source = createSqliteDataSource(filename, { maxIdleConnections: 1 });
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
        expect((await connection.query(select)).rows).toEqual([{ value: 1 }]);
        return query.mock.contexts.at(-1);
    }

    it('reuses an idle handle without sharing a live lease or releasing twice', async () => {
        const first = lease();
        const second = lease();
        const firstNative = await native(first);
        const secondNative = await native(second);
        expect(secondNative).not.toBe(firstNative);
        await first.dispose?.();
        await first.dispose?.();
        const third = lease();
        const fourth = lease();
        expect(await native(third)).toBe(firstNative);
        expect(await native(fourth)).not.toBe(firstNative);
        await expect(first.query(select)).rejects.toThrow('lease was disposed');
        expect(close).not.toHaveBeenCalled();
    });

    it('closes overflow handles and all retained handles on shutdown', async () => {
        const first = lease();
        const second = lease();
        const firstNative = await native(first);
        const secondNative = await native(second);
        await first.dispose?.();
        await second.dispose?.();
        expect(close.mock.contexts).toEqual([secondNative]);
        await source.dispose();
        await source.dispose();
        expect(close.mock.contexts).toEqual([secondNative, firstNative]);
        expect(() => source.createConnection()).toThrow('was disposed');
    });

    it('preserves explicit shutdown ordering with borrowed and idle handles', async () => {
        const first = lease();
        const second = lease();
        await first.dispose?.();
        await expect(source.dispose()).rejects.toThrow('1 connection lease');
        expect(close).not.toHaveBeenCalled();
        await native(second);
    });

    it('keeps fresh connections as the default, including in-memory databases', async () => {
        await source.dispose();
        source = createSqliteDataSource(':memory:');
        const first = lease();
        await first.query({ text: 'create table local_only (id integer)', values: [] });
        await first.dispose?.();
        expect(close).toHaveBeenCalledTimes(1);
        await expect(lease().query({ text: 'select * from local_only', values: [] })).rejects.toThrow('no such table');
    });

    it('allows explicitly disabling reuse', async () => {
        await source.dispose();
        source = createSqliteDataSource(filename, { maxIdleConnections: 0 });
        const first = lease();
        const before = await native(first);
        await first.dispose?.();
        expect(await native(lease())).not.toBe(before);
        expect(close).toHaveBeenCalledTimes(1);
    });

    it.each([-1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, '1', true, null])(
        'rejects invalid idle limits before opening a connection: %s', value => {
            expect(() => createSqliteDataSource(filename, { maxIdleConnections: value as number }))
                .toThrow('non-negative safe integer');
            expect(query).not.toHaveBeenCalled();
        },
    );

    it.each([':memory:', 'file:app.db', 'file::memory:?cache=shared'])(
        'refuses reuse for ambiguous memory/URI ownership: %s', path => {
            expect(() => createSqliteDataSource(path, { maxIdleConnections: 1 }))
                .toThrow('requires a filesystem path');
        },
    );

    it('owns a copy of connection settings for its retained handles', async () => {
        await source.dispose();
        const config = { filename, foreignKeys: true };
        source = createSqliteDataSource(config, { maxIdleConnections: 1 });
        config.foreignKeys = false;
        const result = await lease().query({ text: 'pragma foreign_keys', values: [] });
        expect(result.rows).toEqual([{ foreign_keys: 1 }]);
    });

    it('retains a handle after successful nested transactions', async () => {
        const connection = lease();
        const before = await native(connection);
        await connection.transaction(async () => {
            await connection.query(select);
            await connection.transaction(async () => {
                await connection.query(select);
            });
            await expect(connection.dispose?.()).rejects.toThrow('operation is active');
        });
        expect(connection.isInTransaction).toBe(false);
        await connection.dispose?.();
        expect(await native(lease())).toBe(before);
    });

    it('holds a streamed handle until its iterator closes', async () => {
        const first = lease();
        const before = await native(first);
        const iterator = first.stream?.({ text: 'select 1 as value union all select 2', values: [] }, { batchSize: 1 })[Symbol.asyncIterator]();
        if (!iterator) throw new Error('SQLite stream missing');
        expect(await iterator.next()).toEqual({ done: false, value: { value: 1 } });
        await expect(first.dispose?.()).rejects.toThrow('operation is active');
        const second = lease();
        expect(await native(second)).not.toBe(before);
        await iterator.return?.();
        await first.dispose?.();
        expect(await native(lease())).toBe(before);
    });

    it('does not start a deferred stream against a subsequently borrowed handle', async () => {
        const first = lease();
        const before = await native(first);
        const stream = first.stream?.(select);
        if (!stream) throw new Error('SQLite stream missing');
        await first.dispose?.();
        expect(await native(lease())).toBe(before);
        await expect(stream[Symbol.asyncIterator]().next()).rejects.toThrow('lease was disposed');
    });
});
