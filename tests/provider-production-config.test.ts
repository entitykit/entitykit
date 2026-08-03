import {
    DatabaseProviderError,
    DatabaseTransactionCleanupError,
    TransactionOutcomeUnknownError,
} from '../src';
import {
    createPostgresDataSource,
    PostgresDatabaseConnection,
    pgPool,
    pgPoolCount,
    resetPgConnectionMocks,
} from './support/pg-database-connection-test-support';
import {
    createMysqlClient,
    createMySqlDataSource,
    MySqlDatabaseConnection,
    mysqlPool,
    mysqlPoolCount,
    resetMysqlConnectionMocks,
} from './support/mysql-database-connection-test-support';
import { postgresProviderServices } from '../src/providers/postgres';
import { mySqlProviderServices } from '../src/providers/mysql';

describe('production provider configuration', () => {
    beforeEach(() => {
        resetPgConnectionMocks();
        resetMysqlConnectionMocks();
    });

    it('maps named Postgres settings and gives them precedence over driver options', () => {
        const onPoolError = jest.fn();
        new PostgresDatabaseConnection({
            host: 'db.internal',
            applicationName: 'orders-api',
            commandTimeoutMs: 12_000,
            lockTimeoutMs: 4000,
            idleInTransactionTimeoutMs: 20_000,
            keepAlive: true,
            keepAliveInitialDelayMs: 1000,
            pool: {
                min: 2,
                max: 20,
                idleTimeoutMs: 30_000,
                connectionTimeoutMs: 5000,
                maxUses: 500,
                onError: onPoolError,
            },
            driverOptions: {
                max: 99,
                statement_timeout: 1,
                keepAlive: true,
            },
        });

        expect(pgPool().config).toEqual(expect.objectContaining({
            host: 'db.internal',
            application_name: 'orders-api',
            statement_timeout: 12_000,
            lock_timeout: 4000,
            idle_in_transaction_session_timeout: 20_000,
            keepAlive: true,
            keepAliveInitialDelayMillis: 1000,
            min: 2,
            max: 20,
            idleTimeoutMillis: 30_000,
            connectionTimeoutMillis: 5000,
            maxUses: 500,
        }));
        expect(pgPool().on).toHaveBeenCalledWith('error', onPoolError);
    });

    it('maps MySQL pool settings and applies a per-command timeout', async () => {
        const connection = new MySqlDatabaseConnection({
            host: 'mysql.internal',
            commandTimeoutMs: 8000,
            connectTimeoutMs: 3000,
            keepAlive: true,
            keepAliveInitialDelayMs: 1500,
            pool: {
                max: 15,
                maxIdle: 5,
                queueLimit: 30,
                resetOnRelease: true,
            },
            driverOptions: { connectionLimit: 99, enableKeepAlive: true },
        });
        mysqlPool().query.mockResolvedValueOnce([[], []]);

        await connection.query({ text: 'select ?', values: [1] });

        expect(mysqlPool().config).toEqual(expect.objectContaining({
            host: 'mysql.internal',
            connectTimeout: 3000,
            connectionLimit: 15,
            maxIdle: 5,
            queueLimit: 30,
            resetOnRelease: true,
            enableKeepAlive: true,
            keepAliveInitialDelay: 1500,
            multipleStatements: true,
        }));
        expect(mysqlPool().query).toHaveBeenCalledWith({
            sql: 'select ?',
            values: [1],
            timeout: 8000,
        });
    });

    it('applies the MySQL command timeout to transaction control statements', async () => {
        const connection = new MySqlDatabaseConnection({
            connectionString: 'mysql://localhost/entitykit',
            commandTimeoutMs: 8000,
        });
        const client = createMysqlClient();
        mysqlPool().getConnection.mockResolvedValueOnce(client);

        await connection.transaction(() => undefined);

        expect(client.query.mock.calls).toEqual([
            [{ sql: 'begin', values: [], timeout: 8000 }],
            [{ sql: 'commit', values: [], timeout: 8000 }],
        ]);
    });

    it('creates one Postgres pool and closes it only at data-source shutdown', async () => {
        const source = createPostgresDataSource('postgres://localhost/entitykit');
        const first = source.createConnection();
        const second = source.createConnection();
        expect(pgPoolCount()).toBe(1);

        await first.dispose?.();
        expect(pgPool().end).not.toHaveBeenCalled();
        await expect(source.dispose()).rejects.toThrow(/1 connection lease/);
        await second.dispose?.();
        await source.dispose();
        expect(pgPool().end).toHaveBeenCalledTimes(1);
    });

    it('creates one MySQL pool for all context leases', async () => {
        const source = createMySqlDataSource('mysql://localhost/entitykit');
        const first = source.createConnection();
        const second = source.createConnection();
        expect(mysqlPoolCount()).toBe(1);

        await first.dispose?.();
        await second.dispose?.();
        await source.dispose();
        expect(mysqlPool().end).toHaveBeenCalledTimes(1);
    });

    it('rejects invalid timeout and pool settings before driver use', () => {
        expect(() => new PostgresDatabaseConnection({ commandTimeoutMs: 0 }))
            .toThrow('commandTimeoutMs must be an integer >= 1');
        expect(() => new PostgresDatabaseConnection({ pool: { min: 5, max: 2 } }))
            .toThrow('pool.min must not exceed pool.max');
        expect(() => new MySqlDatabaseConnection({ pool: { max: 0 } }))
            .toThrow('pool.max must be an integer >= 1');
        expect(() => new MySqlDatabaseConnection({ ssl: true } as never))
            .toThrow('provide TLS options or a named SSL profile');
        expect(() => new PostgresDatabaseConnection({
            pool: { onError: false as never },
        })).toThrow('pool.onError must be a function');
        expect(() => new PostgresDatabaseConnection({ port: 70_000 }))
            .toThrow('port must be an integer between 1 and 65535');
        expect(() => new MySqlDatabaseConnection({
            pool: { max: 2, maxIdle: 3 },
        })).toThrow('pool.maxIdle must not exceed pool.max');
        expect(() => new MySqlDatabaseConnection({
            pool: { waitForConnections: 'yes' as never },
        })).toThrow('pool.waitForConnections must be a boolean');
        expect(() => new MySqlDatabaseConnection({ timezone: 'UTC' }))
            .toThrow('timezone must be \'local\', \'Z\', or a signed HH:MM offset');
    });

    it('classifies retry-safe server and transport failures conservatively', () => {
        const postgresNetworkError = new DatabaseProviderError(
            'Postgres query failed.',
            undefined,
            { provider: 'postgres', operation: 'query', code: 'ECONNRESET' },
        );
        const mysqlDeadlock = new DatabaseProviderError(
            'MySQL query failed.',
            undefined,
            { provider: 'mysql', operation: 'query', code: 'ER_LOCK_DEADLOCK' },
        );
        const constraintFailure = new DatabaseProviderError(
            'Postgres query failed.',
            undefined,
            { provider: 'postgres', operation: 'query', code: '23505' },
        );
        const uncertainCommit = new TransactionOutcomeUnknownError(
            'postgres',
            new DatabaseProviderError(
                'Postgres commit failed.',
                undefined,
                {
                    provider: 'postgres',
                    operation: 'commit',
                    code: 'ECONNRESET',
                },
            ),
        );
        const uncertainCleanup = new DatabaseTransactionCleanupError(
            'postgres',
            uncertainCommit,
            new DatabaseProviderError(
                'Postgres rollback failed.',
                undefined,
                {
                    provider: 'postgres',
                    operation: 'rollback',
                    code: 'ECONNRESET',
                },
            ),
        );

        expect(postgresProviderServices.isTransientError?.(postgresNetworkError)).toBe(true);
        expect(mySqlProviderServices.isTransientError?.(mysqlDeadlock)).toBe(true);
        expect(postgresProviderServices.isTransientError?.(constraintFailure)).toBe(false);
        expect(postgresProviderServices.isTransientError?.(uncertainCommit)).toBe(false);
        expect(postgresProviderServices.isTransientError?.(uncertainCleanup)).toBe(false);
    });
});
