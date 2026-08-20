import { MigrationRunner } from '../packages/core/src/migrations/api';
import { migrationLockKey } from '../packages/core/src/migrations/migration-metadata';
import { mySqlMigrationDialect } from '../packages/mysql/src/mysql-migration-dialect';
import { RecordingDatabaseConnection } from './support/recording-database-connection';
import {
    containing,
    stringContaining,
} from './support/jest-asymmetric-matchers';

describe('MySQL migration locks', () => {
    const lockName =
        'concat(?, \':\', left(sha2(coalesce(database(), \'\'), 256), 40))';

    it('uses parameterized database-scoped named lock statements', () => {
        expect(mySqlMigrationDialect.acquireMigrationLockStatement?.()).toEqual({
            text: `select get_lock(${lockName}, -1) as acquired`,
            values: [migrationLockKey],
        });
        expect(mySqlMigrationDialect.releaseMigrationLockStatement?.()).toEqual({
            text: `select release_lock(${lockName}) as released`,
            values: [migrationLockKey],
        });
    });

    it('holds the lock around migration discovery on one session', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult();
        connection.queueResult({ rows: [{ acquired: 1 }] });
        connection.queueResult();
        connection.queueResult({ rows: [] });
        connection.queueResult({ rows: [{ released: 1 }] });

        const result = await new MigrationRunner(
            connection,
            mySqlMigrationDialect,
        ).update([]);

        expect(result).toEqual({
            appliedMigrations: [],
            usedMigrationLock: true,
            transactionSuppressedStatements: 0,
        });
        expect(connection.sessionEvents).toEqual(['start', 'end']);
        expect(connection.statements).toEqual([
            containing({
                text: stringContaining(
                    'create table if not exists `__entitykit_migrations`',
                ),
            }),
            {
                text: `select get_lock(${lockName}, -1) as acquired`,
                values: [migrationLockKey],
            },
            containing({
                text: stringContaining(
                    'create table if not exists `__entitykit_migrations`',
                ),
            }),
            containing({
                text: stringContaining(
                    'from `__entitykit_migrations` order by `id`',
                ),
            }),
            {
                text: `select release_lock(${lockName}) as released`,
                values: [migrationLockKey],
            },
        ]);
    });

    it.each([
        ['NULL', null],
        ['an unexpected zero', 0],
    ])('fails safely when GET_LOCK returns %s', async (_label, acquired) => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult();
        connection.queueResult({ rows: [{ acquired }] });

        await expect(new MigrationRunner(
            connection,
            mySqlMigrationDialect,
        ).update([])).rejects.toMatchObject({
            name: 'MigrationError',
            message: 'MySQL failed to acquire the migration lock.',
            details: containing({
                lockPhase: 'lockAcquire',
                result: acquired,
            }),
        });

        expect(connection.statements).toHaveLength(2);
        expect(connection.sessionEvents).toEqual(['start', 'end']);
    });

    it('fails cleanup when RELEASE_LOCK reports a different owner', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult();
        connection.queueResult({ rows: [{ acquired: 1 }] });
        connection.queueResult();
        connection.queueResult({ rows: [] });
        connection.queueResult({ rows: [{ released: 0 }] });

        await expect(new MigrationRunner(
            connection,
            mySqlMigrationDialect,
        ).update([])).rejects.toMatchObject({
            name: 'MigrationError',
            message: 'MySQL failed to release the migration lock.',
            details: containing({
                lockPhase: 'lockRelease',
                result: 0,
            }),
        });

        expect(connection.sessionEvents).toEqual(['start', 'end']);
    });
});
