import { join } from 'node:path';
import { SqliteDatabaseConnection, defaultSqliteBusyTimeoutMs } from '../src/providers/sqlite';
import { createManagedTempDirectory } from './support/managed-temp-directory';

async function pragma(connection: SqliteDatabaseConnection, name: string): Promise<unknown> {
    const result = await connection.query({ text: `pragma ${name}`, values: [] });
    return Object.values(result.rows[0] ?? {})[0];
}

describe('SQLite connection configuration', () => {
    let dir: string;

    beforeEach(() => {
        dir = createManagedTempDirectory('ek-sqlite-config-');
    });

    it('waits for a write lock instead of failing immediately by default', async () => {
    // SQLite's own default is 0 — fail on the first contended write — which
    // turns ordinary contention between processes into an error.
        const connection = new SqliteDatabaseConnection(':memory:');

        expect(await pragma(connection, 'busy_timeout')).toBe(defaultSqliteBusyTimeoutMs);

        await connection.dispose();
    });

    it('applies a configured busy timeout', async () => {
        const connection = new SqliteDatabaseConnection({ filename: ':memory:', busyTimeoutMs: 250 });

        expect(await pragma(connection, 'busy_timeout')).toBe(250);

        await connection.dispose();
    });

    it('allows restoring the fail-fast default', async () => {
        const connection = new SqliteDatabaseConnection({ filename: ':memory:', busyTimeoutMs: 0 });

        expect(await pragma(connection, 'busy_timeout')).toBe(0);

        await connection.dispose();
    });

    it('applies a configured journal mode', async () => {
    // WAL persists in the file, so it needs a real database rather than :memory:.
        const connection = new SqliteDatabaseConnection({ filename: join(dir, 'wal.db'), journalMode: 'WAL' });

        expect(String(await pragma(connection, 'journal_mode')).toLowerCase()).toBe('wal');

        await connection.dispose();
    });

    it('leaves the journal mode alone when unset', async () => {
        const connection = new SqliteDatabaseConnection({ filename: join(dir, 'plain.db') });

        expect(String(await pragma(connection, 'journal_mode')).toLowerCase()).toBe('delete');

        await connection.dispose();
    });

    it('opens an existing database in read-only mode', async () => {
        const filename = join(dir, 'read-only.db');
        const writable = new SqliteDatabaseConnection(filename);
        await writable.query({ text: 'create table rows (id text)', values: [] });
        await writable.dispose();

        const readOnly = new SqliteDatabaseConnection({ filename, readOnly: true });
        await expect(readOnly.query({
            text: 'select * from rows',
            values: [],
        })).resolves.toMatchObject({ rows: [] });
        await expect(readOnly.query({
            text: 'insert into rows (id) values (?)',
            values: ['blocked'],
        })).rejects.toThrow();
        await readOnly.dispose();
    });

    it('enforces foreign keys by default and allows an explicit legacy opt-out', async () => {
        const normal = new SqliteDatabaseConnection(':memory:');
        expect(await pragma(normal, 'foreign_keys')).toBe(1);
        await normal.dispose();

        const legacy = new SqliteDatabaseConnection({
            filename: ':memory:',
            foreignKeys: false,
        });
        expect(await pragma(legacy, 'foreign_keys')).toBe(0);
        await legacy.dispose();
    });

    it('rejects configuration that would be interpolated into a pragma', () => {
        expect(() => new SqliteDatabaseConnection({ filename: ':memory:', busyTimeoutMs: -1 }))
            .toThrow('busyTimeoutMs must be a non-negative integer');
        expect(() => new SqliteDatabaseConnection({ filename: ':memory:', busyTimeoutMs: 1.5 }))
            .toThrow('busyTimeoutMs must be a non-negative integer');
        // Pragma values cannot be parameterized, so the mode name is constrained.
        expect(() => new SqliteDatabaseConnection({ filename: ':memory:', journalMode: 'WAL; drop table x' }))
            .toThrow('journalMode must be a bare mode name');
        expect(() => new SqliteDatabaseConnection({
            filename: ':memory:',
            connectionString: 'other.db',
        })).toThrow('filename or connectionString, not both');
        expect(() => new SqliteDatabaseConnection({
            filename: ':memory:',
            readOnly: 'yes' as never,
        })).toThrow('readOnly must be a boolean');
    });

    it('keeps case-sensitive like alongside the new pragmas', async () => {
        const connection = new SqliteDatabaseConnection({ filename: ':memory:', busyTimeoutMs: 100 });
        await connection.query({ text: 'create table t (v text)', values: [] });
        await connection.query({ text: 'insert into t values (\'Alpha\')', values: [] });

        const matched = await connection.query({ text: 'select v from t where v like \'a%\'', values: [] });
        expect(matched.rows).toEqual([]);

        await connection.dispose();
    });
});
