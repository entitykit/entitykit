import { throwIfOperationAborted, type DatabaseConnection, type SqlStatement } from '../packages/core/src/adapter';
import { runSqliteMigrationTransaction } from '../packages/sqlite/src/sqlite-migration-transaction';
import {
    expectOriginalRebuildState, rebuildStatements, seededRebuildConnection,
} from './support/sqlite-rebuild-lifecycle-support';

describe('SQLite rebuild constraint scope lifecycle', () => {
    it.each(['main', 'MAIN'])('preserves dependents when the rebuild explicitly targets schema %s', async schema => {
        const connection = await seededRebuildConnection();
        try {
            await runSqliteMigrationTransaction(connection, rebuildStatements(schema), {});

            expect((await connection.rawQuery('select * from child')).rows).toEqual([{ id: 'c', parent_id: 'p' }]);
            expect((await connection.rawQuery('pragma foreign_keys')).rows).toEqual([{ foreign_keys: 1 }]);
            expect((await connection.rawQuery('pragma foreign_key_check')).rows).toEqual([]);
        } finally {
            await connection.forceClose();
        }
    });

    it.each([
        'pragma foreign_keys = off',
        'insert into "__entitykit_new_parent" ("id", "label") select "id", "label" from "parent"',
    ])('restores enforcement after cancellation following %s', async boundary => {
        const connection = await seededRebuildConnection();
        const controller = new AbortController();
        const reason = new Error('migration canceled');
        connection.afterQuery = (statement, options) => {
            if (statement.text === boundary) {
                controller.abort(reason);
                throwIfOperationAborted(options.signal);
            }
        };
        try {
            await expect(runSqliteMigrationTransaction(connection, rebuildStatements(), { signal: controller.signal }))
                .rejects.toMatchObject({ name: 'OperationCanceledError', cause: reason });

            expect(connection.calls.filter(call => call.text === 'pragma foreign_keys = on')).toEqual([
                { text: 'pragma foreign_keys = on', signal: undefined, inTransaction: false },
            ]);
            await expectOriginalRebuildState(connection);
        } finally {
            await connection.forceClose();
        }
    });

    it('restores enforcement and the old schema after a statement failure', async () => {
        const connection = await seededRebuildConnection();
        try {
            await expect(runSqliteMigrationTransaction(connection, [
                ...rebuildStatements(), { text: 'select absent_column from parent', values: [] },
            ], {})).rejects.toMatchObject({ name: 'DatabaseProviderError', operation: 'query' });

            await expectOriginalRebuildState(connection);
            connection.calls.length = 0;
            await runSqliteMigrationTransaction(connection, rebuildStatements(), {});
            expect((await connection.rawQuery('select * from child')).rows).toEqual([{ id: 'c', parent_id: 'p' }]);
            expect(connection.calls.find(call => call.text === 'pragma foreign_keys = off')?.inTransaction).toBe(false);
            expect(connection.calls.find(call => call.text === 'pragma foreign_key_check')?.inTransaction).toBe(true);
            expect(connection.calls.find(call => call.text === 'pragma foreign_keys = on')?.inTransaction).toBe(false);
        } finally {
            await connection.forceClose();
        }
    });

    it('preserves explicitly disabled enforcement without introducing validation', async () => {
        const connection = await seededRebuildConnection();
        try {
            await connection.rawQuery('pragma foreign_keys = off');
            await runSqliteMigrationTransaction(connection, rebuildStatements(), {});

            expect((await connection.rawQuery('pragma foreign_keys')).rows).toEqual([{ foreign_keys: 0 }]);
            expect((await connection.rawQuery('select * from child')).rows).toEqual([{ id: 'c', parent_id: 'p' }]);
            expect(connection.calls.map(call => call.text)).not.toContain('pragma foreign_key_check');
            expect(connection.calls.map(call => call.text)).not.toContain('pragma foreign_keys = on');
        } finally {
            await connection.forceClose();
        }
    });

    it.each<{ prefix: readonly SqlStatement[] }>([
        { prefix: [{ text: 'pragma defer_foreign_keys = on', values: [] }] },
        { prefix: [{ text: 'create table "__entitykit_new_user_owned" (id text)', values: [] }] },
    ])('keeps ordinary deferred and user-created-table transactions on the normal path: %j', async ({ prefix }) => {
        const connection = await seededRebuildConnection();
        try {
            await runSqliteMigrationTransaction(connection, [
                ...prefix, { text: 'delete from parent', values: [] },
            ], {});

            expect((await connection.rawQuery('select * from child')).rows).toEqual([]);
            expect((await connection.rawQuery('pragma foreign_keys')).rows).toEqual([{ foreign_keys: 1 }]);
            expect(connection.calls.map(call => call.text)).not.toContain('pragma foreign_keys = off');
        } finally {
            await connection.forceClose();
        }
    });

    it('refuses to change enforcement inside a caller-owned transaction', async () => {
        const connection = await seededRebuildConnection();
        try {
            await connection.transaction(async () => {
                await expect(runSqliteMigrationTransaction(connection, rebuildStatements(), {}))
                    .rejects.toThrow('SQLite table rebuilds require an owned root transaction.');
                expect(connection.calls).toEqual([]);
                expect((await connection.rawQuery('pragma foreign_keys')).rows).toEqual([{ foreign_keys: 1 }]);
            });
            await expectOriginalRebuildState(connection);
        } finally {
            await connection.forceClose();
        }
    });

    it('refuses an unreadable enforcement setting before mutating the database', async () => {
        const connection = await seededRebuildConnection();
        connection.afterQuery = (statement, _options, result) => {
            if (statement.text === 'pragma foreign_keys') result?.rows.splice(0);
        };
        try {
            await expect(runSqliteMigrationTransaction(connection, rebuildStatements(), {}))
                .rejects.toThrow('SQLite did not report its foreign-key enforcement setting.');
            expect(connection.calls.map(call => call.text)).toEqual(['pragma foreign_keys']);
            await expectOriginalRebuildState(connection);
        } finally {
            await connection.forceClose();
        }
    });

    it('refuses an ignored suspension request and restores the original setting', async () => {
        const connection = await seededRebuildConnection();
        connection.afterQuery = async statement => {
            if (statement.text === 'pragma foreign_keys = off') await connection.rawQuery('pragma foreign_keys = on');
        };
        try {
            await expect(runSqliteMigrationTransaction(connection, rebuildStatements(), {}))
                .rejects.toThrow('SQLite could not suspend foreign keys before rebuilding tables.');
            await expectOriginalRebuildState(connection);
        } finally {
            await connection.forceClose();
        }
    });

    it.each([false, true])('discards the connection after restoration fails, preserving primary failure=%s', async failWork => {
        const connection = await seededRebuildConnection();
        const primary = new Error('migration work failed');
        const cleanup = new Error('foreign-key restore failed');
        connection.beforeQuery = statement => {
            if (statement.text === 'pragma foreign_keys = on') throw cleanup;
            if (statement.text === 'select fixture_failure') throw primary;
        };
        try {
            const statements = failWork
                ? [...rebuildStatements(), { text: 'select fixture_failure', values: [] }]
                : rebuildStatements();
            const outcome = runSqliteMigrationTransaction(connection, statements, {});
            if (failWork) {
                await expect(outcome).rejects.toMatchObject({
                    name: 'DatabaseTransactionCleanupError', provider: 'sqlite', primaryError: primary,
                    cleanupError: {
                        name: 'DatabaseProviderError', provider: 'sqlite', cause: cleanup, operation: 'query',
                        statement: { text: 'pragma foreign_keys = on', values: [] },
                    },
                });
            } else {
                await expect(outcome).rejects.toMatchObject({ name: 'DatabaseProviderError', cause: cleanup });
            }
            expect(connection.disposed).toBe(true);
            await expect(connection.rawQuery('select 1')).rejects.toThrow();
        } finally {
            await connection.forceClose();
        }
    });

    it('discards a connection whose restoration command returns without restoring enforcement', async () => {
        const connection = await seededRebuildConnection();
        connection.afterQuery = async statement => {
            if (statement.text === 'pragma foreign_keys = on') await connection.rawQuery('pragma foreign_keys = off');
        };
        try {
            await expect(runSqliteMigrationTransaction(connection, rebuildStatements(), {})).rejects.toMatchObject({
                name: 'DatabaseProviderError',
                cause: { message: 'SQLite could not restore foreign keys after rebuilding tables.' },
            });
            expect(connection.disposed).toBe(true);
        } finally {
            await connection.forceClose();
        }
    });

    it('retains both restoration and disposal failures', async () => {
        const connection = await seededRebuildConnection();
        const cleanup = new Error('restore failed');
        const disposal = new Error('dispose failed');
        connection.disposeFailure = disposal;
        connection.beforeQuery = statement => {
            if (statement.text === 'pragma foreign_keys = on') throw cleanup;
        };
        try {
            await expect(runSqliteMigrationTransaction(connection, rebuildStatements(), {})).rejects.toMatchObject({
                name: 'DatabaseProviderError',
                cause: {
                    name: 'AggregateError', errors: [cleanup, disposal],
                    message: 'SQLite foreign-key restoration and connection disposal failed.',
                },
            });
            expect(connection.disposed).toBe(false);
        } finally {
            await connection.forceClose();
        }
    });

    it('reports restoration failure for a borrowed connection without a disposer', async () => {
        const connection = await seededRebuildConnection();
        const cleanup = new Error('borrowed connection restore failed');
        connection.beforeQuery = statement => {
            if (statement.text === 'pragma foreign_keys = on') throw cleanup;
        };
        const borrowed: DatabaseConnection = {
            get isInTransaction() {
                return connection.isInTransaction; 
            },
            query: connection.query.bind(connection),
            transaction: connection.transaction.bind(connection),
        };
        try {
            await expect(runSqliteMigrationTransaction(borrowed, rebuildStatements(), {})).rejects.toMatchObject({
                name: 'DatabaseProviderError', provider: 'sqlite', cause: cleanup,
                statement: { text: 'pragma foreign_keys = on', values: [] },
            });
        } finally {
            await connection.forceClose();
        }
    });
});
