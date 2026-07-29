import { DatabaseTransactionCleanupError } from '../src';
import { SqliteDatabaseConnection } from '../src/providers/sqlite';
import { SqliteTransactionRunner } from '../src/providers/sqlite/sqlite-transaction-runner';

async function pragma(
    connection: SqliteDatabaseConnection,
    name: string,
): Promise<unknown> {
    const result = await connection.query({ text: `pragma ${name}`, values: [] });
    return Object.values(result.rows[0] ?? {})[0];
}

describe('SQLite transaction options', () => {
    it('scopes read-uncommitted mode to one transaction', async () => {
        const connection = new SqliteDatabaseConnection(':memory:');

        await connection.transaction(async () => {
            expect(await pragma(connection, 'read_uncommitted')).toBe(1);
        }, { isolationLevel: 'readUncommitted' });

        expect(await pragma(connection, 'read_uncommitted')).toBe(0);
        await connection.dispose();
    });

    it('enforces read-only work and restores writes afterward', async () => {
        const connection = new SqliteDatabaseConnection(':memory:');
        await connection.query({ text: 'create table rows (id text)', values: [] });

        await expect(connection.transaction(async () => {
            await connection.query({
                text: 'insert into rows (id) values (?)',
                values: ['blocked'],
            });
        }, { readOnly: true })).rejects.toThrow();

        await connection.query({
            text: 'insert into rows (id) values (?)',
            values: ['allowed'],
        });
        const result = await connection.query({
            text: 'select count(*) as count from rows',
            values: [],
        });
        expect(result.rows[0]?.count).toBe(1);
        await connection.dispose();
    });

    it('rejects isolation levels SQLite cannot represent', async () => {
        const connection = new SqliteDatabaseConnection(':memory:');

        await expect(connection.transaction(
            () => undefined,
            { isolationLevel: 'readCommitted' },
        )).rejects.toThrow('does not support \'readCommitted\'');
        await expect(connection.transaction(
            () => undefined,
            { isolationLevel: 'repeatableRead' },
        )).rejects.toThrow('does not support \'repeatableRead\'');

        await connection.dispose();
    });

    it('preserves a transaction failure when option cleanup also fails', async () => {
        const primary = new Error('work failed');
        const resetFailure = new Error('reset failed');
        const runner = new SqliteTransactionRunner(sql => {
            if (sql === 'pragma query_only = OFF') {
                throw resetFailure;
            }
        });

        try {
            await runner.transaction(
                () => {
                    throw primary;
                },
                { readOnly: true },
            );
            throw new Error('Expected the transaction to fail.');
        } catch (error) {
            expect(error).toBeInstanceOf(DatabaseTransactionCleanupError);
            if (!(error instanceof DatabaseTransactionCleanupError)) {
                return;
            }
            expect(error.primaryError).toBe(primary);
            expect(error.cleanupError).toMatchObject({
                name: 'DatabaseProviderError',
                operation: 'rollback',
                cause: resetFailure,
            });
        }
    });

    it('attempts savepoint cleanup when release fails', async () => {
        const statements: string[] = [];
        const releaseFailure = new Error('release failed');
        const runner = new SqliteTransactionRunner((sql, operation) => {
            statements.push(sql);
            if (operation === 'releaseSavepoint') {
                throw releaseFailure;
            }
        });

        await runner.transaction(async () => {
            await expect(runner.transaction(() => 'nested'))
                .rejects.toBe(releaseFailure);
        });

        expect(statements).toEqual([
            'begin',
            'savepoint entitykit_sp_1',
            'release savepoint entitykit_sp_1',
            'rollback to savepoint entitykit_sp_1',
            'commit',
        ]);
    });

    it('rolls back the root when application code catches a failed savepoint', async () => {
        const statements: string[] = [];
        const savepointFailure = new Error('savepoint failed');
        const runner = new SqliteTransactionRunner((sql, operation) => {
            statements.push(sql);
            if (operation === 'savepoint') {
                throw savepointFailure;
            }
        });

        await expect(runner.transaction(async () => {
            await expect(runner.transaction(() => 'never'))
                .rejects.toBe(savepointFailure);
            return 'caught';
        })).rejects.toBe(savepointFailure);

        expect(statements).toEqual([
            'begin',
            'savepoint entitykit_sp_1',
            'rollback',
        ]);
    });
});
