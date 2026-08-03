import { DbContext, type OutboxOptions } from '../src';
import type { DatabaseProviderServices } from '../src/adapter';
import { DbContextOptionsBuilder } from '../src/core/context-options/db-context-options-builder';
import type { ConnectionOwnership } from '../src/core/context-options/db-context-option-types';
import { postgresDialect } from '../src/providers/postgres';
import { MigrationBuilder, postgresMigrationDialect } from '../src/migrations/api';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class DisposableConnection extends RecordingDatabaseConnection {
    public readonly dispose = jest.fn(async (): Promise<void> => Promise.resolve());
}

class OwnershipContext extends DbContext {
    constructor(
        private readonly connection: DisposableConnection,
        private readonly ownership: ConnectionOwnership,
    ) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(this.connection, { ownership: this.ownership });
    }
}

describe('DbContextOptionsBuilder', () => {
    it('configures Postgres provider options', () => {
        const options = new DbContextOptionsBuilder()
            .usePostgres('postgres://localhost/ef_ts')
            .build();

        expect(options.provider).toEqual({ provider: 'postgres' });
        expect(options.dialect).toBe(postgresDialect);
        expect(options.migrationDialect).toBe(postgresMigrationDialect);
    });

    it('throws when no provider is configured', () => {
        expect(() => new DbContextOptionsBuilder().build()).toThrow('must configure a database provider');
    });

    it('throws for an empty Postgres connection string', () => {
        expect(() => new DbContextOptionsBuilder().usePostgres(' ')).toThrow('must not be empty');
    });

    it('requires outbox configurations to clear committed events', () => {
        const invalid = {
            collectEvents: () => [],
        } as unknown as OutboxOptions;

        expect(() => new DbContextOptionsBuilder().useOutbox(invalid))
            .toThrow('useOutbox requires a clearEvents callback');
    });

    it('accepts named non-Postgres provider options for provider experiments', () => {
        const connection = new RecordingDatabaseConnection();

        const options = new DbContextOptionsBuilder()
            .useConnection(
                connection,
                {
                    provider: 'sqlite',
                    dialect: postgresDialect,
                    migrationDialect: postgresMigrationDialect,
                },
            )
            .build();

        expect(options.provider).toEqual({ provider: 'sqlite' });
        expect(options.connection).toBe(connection);
    });

    it('uses provider services to create named provider connections', () => {
        const connection = new RecordingDatabaseConnection();
        const provider: DatabaseProviderServices = {
            name: 'sqlite',
            dialect: postgresDialect,
            migrationDialect: postgresMigrationDialect,
            createMigrationBuilder: () => new MigrationBuilder(postgresDialect),
            createConnection(config) {
                expect(config).toEqual({ connectionString: 'file:app.db' });
                return connection;
            },
        };

        const options = new DbContextOptionsBuilder()
            .useProvider(provider, { connectionString: 'file:app.db' })
            .build();

        expect(options.provider).toEqual({ provider: 'sqlite' });
        expect(options.connection).toBe(connection);
        expect(options.dialect).toBe(postgresDialect);
        expect(options.migrationDialect).toBe(postgresMigrationDialect);
    });

    it('returns immutable options', () => {
        const options = new DbContextOptionsBuilder()
            .usePostgres('postgres://localhost/ef_ts')
            .build();

        expect(Object.isFrozen(options)).toBe(true);
        expect(Object.isFrozen(options.provider)).toBe(true);
    });

    it('rejects ambiguous multiple database selections before creating resources', () => {
        const createConnection = jest.fn(() => new RecordingDatabaseConnection());
        const provider: DatabaseProviderServices = {
            name: 'lazy-test',
            dialect: postgresDialect,
            migrationDialect: postgresMigrationDialect,
            createMigrationBuilder: () => new MigrationBuilder(postgresDialect),
            createConnection,
        };
        const builder = new DbContextOptionsBuilder()
            .useProvider(provider, { connectionString: 'first' });

        expect(() => builder.useConnection(new RecordingDatabaseConnection()))
            .toThrow('Choose exactly one provider, data source, or connection');
        expect(createConnection).not.toHaveBeenCalled();
    });

    it('rejects an invalid data source before it acquires a connection', () => {
        const createConnection = jest.fn(() => new RecordingDatabaseConnection());
        const invalid = {
            providerName: 'invalid',
            createConnection,
        };

        expect(() => new DbContextOptionsBuilder().useDataSource(invalid as never))
            .toThrow('must supply a runtime SQL dialect');
        expect(createConnection).not.toHaveBeenCalled();
    });

    it('honors explicit connection ownership', async () => {
        const external = new DisposableConnection();
        const externalContext = OwnershipContext.create(external, 'external');
        await externalContext.dispose();
        expect(external.dispose).not.toHaveBeenCalled();

        const owned = new DisposableConnection();
        const ownedContext = OwnershipContext.create(owned, 'context');
        await ownedContext.dispose();
        expect(owned.dispose).toHaveBeenCalledTimes(1);
    });

    it('rejects invalid runtime ownership values', () => {
        expect(() => new DbContextOptionsBuilder().useConnection(
            new DisposableConnection(),
            { ownership: 'shared' as never },
        )).toThrow('must be \'context\' or \'external\'');
    });

    it('passes transaction controls through the context boundary', async () => {
        const connection = new DisposableConnection();
        const context = OwnershipContext.create(connection, 'context');

        await context.transaction(
            () => undefined,
            { isolationLevel: 'serializable', readOnly: true },
        );

        expect(connection.transactionOptions).toEqual([{
            isolationLevel: 'serializable',
            readOnly: true,
        }]);
        await context.dispose();
    });

    it('preserves a context disposal failure across repeated calls', async () => {
        const failure = new Error('connection disposal failed');
        const connection = new DisposableConnection();
        connection.dispose.mockRejectedValue(failure);
        const context = OwnershipContext.create(connection, 'context');

        await expect(context.dispose()).rejects.toBe(failure);
        await expect(context.dispose()).rejects.toBe(failure);
        expect(connection.dispose).toHaveBeenCalledTimes(1);
    });
});
