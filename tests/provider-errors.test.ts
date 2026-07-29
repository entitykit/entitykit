import {
    DatabaseProviderError,
    DatabaseTransactionCleanupError,
    ForeignKeyConstraintError,
    NotNullConstraintError,
    UniqueConstraintError,
} from '../src';
import { mapDatabaseProviderError } from '../src/adapter';
import { MigrationLockReleaseError } from '../src/migrations/api';
import { createPostgresProviderError } from '../src/providers/postgres/postgres-provider-error';

describe('DatabaseProviderError', () => {
    it('wraps postgres query errors with provider metadata and the failed statement', () => {
        const cause = {
            code: '23505',
            constraint: 'ux_users_email',
            table: 'users',
            column: 'email',
            detail: 'Key (email)=(a@example.com) already exists.',
        };
        const statement = { text: 'insert into "users" ("email") values ($1)', values: ['a@example.com'] };

        const error = createPostgresProviderError('query', cause, statement);

        expect(error).toBeInstanceOf(DatabaseProviderError);
        expect(error.message).toBe('Postgres query failed (23505).');
        expect(error.provider).toBe('postgres');
        expect(error.operation).toBe('query');
        expect(error.code).toBe('23505');
        expect(error.constraint).toBe('ux_users_email');
        expect(error.statement).toEqual(statement);
        expect(error.toJSON()).toMatchObject({
            provider: 'postgres',
            operation: 'query',
            code: '23505',
            table: 'users',
            column: 'email',
            statement: {
                text: statement.text,
                values: ['<redacted:string>'],
            },
        });
        expect(error.toJSON({ includeSensitiveData: true }))
            .toMatchObject({ statement: { values: ['"a@example.com"'] } });
    });

    it('handles non-object causes without losing the original cause', () => {
        const error = createPostgresProviderError('connect', 'network down');

        expect(error.message).toBe('Postgres connect failed.');
        expect(error.operation).toBe('connect');
        expect(error.cause).toBe('network down');
    });

    it('preserves non-Postgres provider metadata for provider experiments', () => {
        const cause = { code: 'SQLITE_BUSY' };
        const statement = { text: 'select * from `users`', values: [] };

        const error = new DatabaseProviderError('Fake provider query failed.', cause, {
            provider: 'fake-provider',
            operation: 'query',
            statement,
            code: 'SQLITE_BUSY',
        });

        expect(error).toMatchObject({
            provider: 'fake-provider',
            operation: 'query',
            code: 'SQLITE_BUSY',
            statement,
        });
        expect(error.toJSON()).toMatchObject({
            provider: 'fake-provider',
            operation: 'query',
            code: 'SQLITE_BUSY',
        });
    });

    it('maps postgres unique violations to typed update errors', () => {
        const cause = createPostgresProviderError('query', {
            code: '23505',
            constraint: 'ux_users_email',
        });

        const mapped = mapDatabaseProviderError(cause);

        expect(mapped).toBeInstanceOf(UniqueConstraintError);
        expect(mapped).toMatchObject({
            message: 'Unique constraint violation on \'ux_users_email\'.',
            cause,
        });
    });

    it('maps postgres foreign-key violations to typed update errors', () => {
        const cause = createPostgresProviderError('query', {
            code: '23503',
            constraint: 'fk_posts_users_author_id',
        });

        const mapped = mapDatabaseProviderError(cause);

        expect(mapped).toBeInstanceOf(ForeignKeyConstraintError);
        expect(mapped).toMatchObject({
            message: 'Foreign key constraint violation on \'fk_posts_users_author_id\'.',
            cause,
        });
    });

    it('maps postgres not-null violations to typed update errors', () => {
        const cause = createPostgresProviderError('query', {
            code: '23502',
            column: 'email',
        });

        const mapped = mapDatabaseProviderError(cause);

        expect(mapped).toBeInstanceOf(NotNullConstraintError);
        expect(mapped).toMatchObject({
            message: 'Required database column was null: \'email\'.',
            cause,
        });
    });

    it('leaves unknown provider errors unchanged', () => {
        const cause = createPostgresProviderError('query', { code: '57014' });
        const plain = new Error('plain');

        expect(mapDatabaseProviderError(cause)).toBe(cause);
        expect(mapDatabaseProviderError(plain)).toBe(plain);
    });

    it('preserves primary and cleanup errors for failed transaction cleanup', () => {
        const primary = createPostgresProviderError('commit', { code: 'COMMIT_FAILED' });
        const cleanup = createPostgresProviderError('rollback', { code: 'ROLLBACK_FAILED' });

        const error = new DatabaseTransactionCleanupError('postgres', primary, cleanup);

        expect(error).toMatchObject({
            name: 'DatabaseTransactionCleanupError',
            provider: 'postgres',
            operation: 'rollback',
            primaryError: primary,
            cleanupError: cleanup,
            cause: cleanup,
        });
        expect(error.message).toBe('Postgres rollback failed while cleaning up a transaction failure.');
        expect(error.toJSON()).toMatchObject({
            name: 'DatabaseTransactionCleanupError',
            provider: 'postgres',
            operation: 'rollback',
            primaryError: { operation: 'commit', code: 'COMMIT_FAILED' },
            cleanupError: { operation: 'rollback', code: 'ROLLBACK_FAILED' },
        });
    });

    it('preserves primary and release errors for failed migration lock release cleanup', () => {
        const primary = new Error('migration failed');
        const release = createPostgresProviderError('query', { code: 'UNLOCK_FAILED' }, { text: 'select pg_advisory_unlock(hashtext($1))', values: ['entitykit:migrations'] });

        const error = new MigrationLockReleaseError(release, primary);

        expect(error).toMatchObject({
            name: 'MigrationLockReleaseError',
            primaryError: primary,
            releaseError: release,
            cause: release,
        });
        expect(error.toJSON()).toMatchObject({
            schemaVersion: 1,
            name: 'MigrationLockReleaseError',
            code: 'MIGRATION_LOCK_RELEASE',
            details: {
                lockPhase: 'lockRelease',
                primaryError: { name: 'Error' },
                releaseError: { name: 'DatabaseProviderError' },
            },
        });
    });
});
