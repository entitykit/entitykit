import { contextOptions } from './support/public-api-internals';
import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DatabaseProviderError, DbContext } from '../packages/core/src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class User {
    public id!: string;
    public email!: string;
}

class AppDbContext extends DbContext {
    public static connection: RecordingDatabaseConnection;

    public users = this.set(User);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(AppDbContext.connection);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(User, entity => {
            entity.toTable('users');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(user => user.email).hasColumnName('email').hasColumnType('text').isRequired();
            entity.hasIndex(user => user.email).isUnique();
        });
    }
}

describe('database connection abstraction', () => {
    it('exposes a high-level database facade with idempotent creation', async () => {
        const connection = new RecordingDatabaseConnection();
        AppDbContext.connection = connection;
        const db = AppDbContext.create();

        await db.database.ensureCreated();

        expect(db.database.providerName).toBe('custom');
        expect(db.database.connection).toBe(contextOptions(db).connection);
        expect(db.database.createScript()).toContain(
            'create table if not exists "users"',
        );
        expect(connection.statements).toHaveLength(2);
        expect(connection.statements[0]?.text).toContain(
            'create table if not exists "users"',
        );
        expect(connection.statements[1]?.text).toContain(
            'create unique index if not exists',
        );
    });

    it('allows tests and contexts to use a custom connection', async () => {
        const connection = new RecordingDatabaseConnection();
        AppDbContext.connection = connection;
        const db =  AppDbContext.create();

        connection.queueResult({ rows: [{ id: 'usr_1' }], rowCount: 1 });
        const result = await db.database.connection.query({ text: 'select $1', values: ['usr_1'] });

        expect(result.rows).toEqual([{ id: 'usr_1' }]);
        expect(connection.statements).toEqual([{ text: 'select $1', values: ['usr_1'] }]);
        expect(contextOptions(db).provider.provider).toBe('custom');
    });

    it('records transaction commit and rollback behavior', async () => {
        const connection = new RecordingDatabaseConnection();

        await connection.transaction(async () => {
            await connection.query({ text: 'select 1', values: [] });
        });

        await expect(connection.transaction(() => {
            throw new Error('boom');
        })).rejects.toThrow('boom');

        expect(connection.transactionEvents).toEqual(['begin', 'commit', 'begin', 'rollback']);
    });

    it('records nested transaction savepoint behavior', async () => {
        const connection = new RecordingDatabaseConnection();

        await connection.transaction(async () => {
            await connection.transaction(async () => {
                await connection.query({ text: 'select nested', values: [] });
            });

            await expect(connection.transaction(() => {
                throw new Error('nested failed');
            })).rejects.toThrow('nested failed');
        });

        expect(connection.transactionEvents).toEqual([
            'begin',
            'savepoint:entitykit_sp_1',
            'release:entitykit_sp_1',
            'savepoint:entitykit_sp_1',
            'rollback-to:entitykit_sp_1',
            'commit',
        ]);
    });

    it('exposes provider error cause', () => {
        const cause = new Error('database exploded');
        const error = new DatabaseProviderError('Provider failed.', cause, { provider: 'postgres', operation: 'query' });

        expect(error.name).toBe('DatabaseProviderError');
        expect(error.cause).toBe(cause);
    });
});
