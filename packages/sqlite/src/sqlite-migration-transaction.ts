import { MigrationError } from '@entitykit/core/migrations';
import { DatabaseTransactionCleanupError } from '@entitykit/core/adapter';
import type { DatabaseConnection, DatabaseOperationOptions, SqlStatement } from '@entitykit/core/adapter';
import { sqliteError } from './sqlite-error';

/** Execute SQLite rebuilds without firing delete actions on the replaced table. */
export async function runSqliteMigrationTransaction(
    database: DatabaseConnection,
    statements: readonly SqlStatement[],
    options: DatabaseOperationOptions,
): Promise<void> {
    const work = async (): Promise<void> => {
        for (const statement of statements) {
            await database.query(statement, options);
        }
    };
    // Recognize the unchanged builder output, including existing migration files.
    // A user's unrelated deferred-constraint transaction retains normal behavior.
    const rebuild = statements.some(statement => statement.text === 'pragma defer_foreign_keys = on') &&
        statements.some(statement => {
            const sql = statement.text.toLowerCase();
            return sql.startsWith('create table "__entitykit_new_') ||
                sql.startsWith('create table "main"."__entitykit_new_');
        });
    if (!rebuild) {
        return database.transaction(work, options);
    }
    if (database.isInTransaction) {
        throw new MigrationError('SQLite table rebuilds require an owned root transaction.');
    }
    const enabled = await foreignKeysEnabled(database, options);
    if (!enabled) {
        return database.transaction(work, options);
    }

    let failure: { error: unknown } | undefined;
    try {
        await database.query({ text: 'pragma foreign_keys = off', values: [] }, options);
        if (await foreignKeysEnabled(database, options)) {
            throw new MigrationError('SQLite could not suspend foreign keys before rebuilding tables.');
        }
        await database.transaction(async () => {
            await work();
            const violations = await database.query({ text: 'pragma foreign_key_check', values: [] }, options);
            if (violations.rows.length > 0) {
                throw new MigrationError('SQLite table rebuild would leave foreign-key violations.', {
                    details: { foreignKeyViolations: violations.rows },
                });
            }
        }, options);
    } catch (error) {
        failure = { error };
    }
    try {
        // Cleanup must run even if the caller's signal was canceled.
        await database.query({ text: 'pragma foreign_keys = on', values: [] });
        if (!await foreignKeysEnabled(database)) {
            throw new MigrationError('SQLite could not restore foreign keys after rebuilding tables.');
        }
    } catch (error) {
        let cleanupError: unknown = error;
        try {
            await database.dispose?.();
        } catch (disposeError) {
            cleanupError = new AggregateError([error, disposeError], 'SQLite foreign-key restoration and connection disposal failed.');
        }
        const cleanup = sqliteError('query', cleanupError, { text: 'pragma foreign_keys = on', values: [] });
        if (failure) {
            throw new DatabaseTransactionCleanupError('sqlite', failure.error, cleanup);
        }
        throw cleanup;
    }
    if (failure) throw failure.error;
}

async function foreignKeysEnabled(
    database: DatabaseConnection,
    options?: DatabaseOperationOptions,
): Promise<boolean> {
    const result = await database.query({ text: 'pragma foreign_keys', values: [] }, options);
    const value = result.rows[0]?.foreign_keys;
    if (value !== 0 && value !== 1) {
        throw new MigrationError('SQLite did not report its foreign-key enforcement setting.');
    }
    return value === 1;
}
