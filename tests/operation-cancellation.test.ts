import type {
    DatabaseOperationOptions,
    DatabaseQueryResult,
    DbContextOptionsBuilder,
    ModelBuilder,
    SqlStatement,
} from '../src';
import {
    DbContext,
    EntityState,
    OperationCanceledError,
} from '../src';
import type { MigrationBuilder } from '../src/migrations';
import {
    contextMigrations,
    Migration,
    MigrationRunner,
} from '../src/migrations';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class User {
    public id!: string;
    public email!: string;
}

class CancellationContext extends DbContext {
    public static connection: RecordingDatabaseConnection;
    public readonly users = this.set(User);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(CancellationContext.connection);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(User, entity => {
            entity.toTable('users');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnType('text').isRequired();
            entity.property(user => user.email).hasColumnType('text').isRequired();
        });
    }
}

class CancelMigration extends Migration {
    public readonly id = '20260731000000_Cancel';
    public readonly name = 'Cancel';

    public override up(builder: MigrationBuilder): void {
        builder.sql('create table cancellation_probe (id text primary key)');
    }

    public override down(builder: MigrationBuilder): void {
        builder.sql('drop table cancellation_probe');
    }
}

class AbortAfterQueryConnection extends RecordingDatabaseConnection {
    public controller?: AbortController;
    public abortWhen?: (statement: SqlStatement) => boolean;
    public readonly queryOptions: Array<DatabaseOperationOptions | undefined> = [];

    public override async query<
        TRow extends Record<string, unknown> = Record<string, unknown>,
    >(
        statement: SqlStatement,
        options?: DatabaseOperationOptions,
    ): Promise<DatabaseQueryResult<TRow>> {
        this.queryOptions.push(options);
        const result = await super.query<TRow>(statement, options);
        if (this.abortWhen?.(statement)) {
            this.controller?.abort('test cancellation');
        }
        if (options?.signal?.aborted) {
            throw new OperationCanceledError(options.signal.reason);
        }
        return result;
    }
}

function createDb(
    connection: RecordingDatabaseConnection = new RecordingDatabaseConnection(),
): CancellationContext {
    CancellationContext.connection = connection;
    return CancellationContext.create();
}

function canceledOptions(): DatabaseOperationOptions {
    const controller = new AbortController();
    controller.abort('stop now');
    return { signal: controller.signal };
}

describe('operation-wide cancellation', () => {
    it('rejects buffered entity, projection, aggregate, and raw entity queries', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = createDb(connection);
        const options = canceledOptions();

        await expect(db.users.toArray(options)).rejects.toBeInstanceOf(OperationCanceledError);
        await expect(db.users.find('usr_1', options)).rejects.toBeInstanceOf(OperationCanceledError);
        await expect(db.users.findOrThrow('usr_1', options)).rejects.toBeInstanceOf(OperationCanceledError);
        await expect(db.users.select(user => ({ email: user.email })).first(options))
            .rejects.toBeInstanceOf(OperationCanceledError);
        await expect(db.users.aggregate(value => ({ count: value.count() })).single(options))
            .rejects.toBeInstanceOf(OperationCanceledError);
        await expect(db.users.fromSqlUnsafe`select id, email from users`.toArray(options))
            .rejects.toBeInstanceOf(OperationCanceledError);

        expect(connection.statements).toEqual([]);
    });

    it('rejects a canceled find before returning a tracked entity', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = createDb(connection);
        db.users.attach({ id: 'usr_1', email: 'a@example.com' });

        await expect(db.users.find('usr_1', canceledOptions()))
            .rejects.toBeInstanceOf(OperationCanceledError);
        expect(connection.statements).toEqual([]);
    });

    it('rolls back a canceled save and leaves tracked state retryable', async () => {
        const connection = new AbortAfterQueryConnection();
        const controller = new AbortController();
        connection.controller = controller;
        connection.abortWhen = statement => statement.text.startsWith('insert into "users"');
        const db = createDb(connection);
        const user = { id: 'usr_1', email: 'a@example.com' };
        db.users.add(user);

        await expect(db.saveChanges({ signal: controller.signal }))
            .rejects.toBeInstanceOf(OperationCanceledError);

        expect(connection.transactionEvents).toEqual(['begin', 'rollback']);
        expect(connection.transactionOptions[0]?.signal).toBe(controller.signal);
        expect(db.entry(user)?.state).toBe(EntityState.Added);
    });

    it('rolls back an explicit transaction when its operation signal is aborted', async () => {
        const connection = new RecordingDatabaseConnection();
        const controller = new AbortController();
        const db = createDb(connection);

        await expect(db.transaction(async () => {
            await Promise.resolve();
            controller.abort('cancel transaction');
        }, { signal: controller.signal })).rejects.toBeInstanceOf(
            OperationCanceledError,
        );

        expect(connection.transactionEvents).toEqual(['begin', 'rollback']);
    });

    it('cancels raw SQL, prepared statements, and schema creation through the facade', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = createDb(connection);
        const scoped = db.database.withOptions(canceledOptions());

        await expect(scoped.sql`select 1`).rejects.toBeInstanceOf(OperationCanceledError);
        await expect(scoped.execute`update users set email = ${'a@example.com'}`)
            .rejects.toBeInstanceOf(OperationCanceledError);
        await expect(scoped.executeStatement({ text: 'delete from users', values: [] }))
            .rejects.toBeInstanceOf(OperationCanceledError);
        await expect(scoped.ensureCreated()).rejects.toBeInstanceOf(OperationCanceledError);

        expect(connection.statements).toEqual([]);
    });

    it('rolls back migration work, preserves cancellation, and releases its lock', async () => {
        const connection = new AbortAfterQueryConnection();
        const controller = new AbortController();
        connection.controller = controller;
        connection.abortWhen = statement =>
            statement.text === 'create table cancellation_probe (id text primary key)';
        connection.queueResult();
        connection.queueResult();
        connection.queueResult();
        connection.queueResult({
            rows: [{ pg_advisory_unlock: true }],
            rowCount: 1,
        });

        await expect(new MigrationRunner(connection).apply(
            new CancelMigration(),
            { signal: controller.signal },
        )).rejects.toBeInstanceOf(OperationCanceledError);

        expect(connection.transactionEvents).toEqual(['begin', 'rollback']);
        expect(connection.statements.at(-1)?.text).toBe(
            'select pg_advisory_unlock(hashtext($1))',
        );
        expect(connection.queryOptions.at(-1)).toBeUndefined();
    });

    it('accepts cancellation options through context migration tooling', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = createDb(connection);

        await expect(contextMigrations(db).apply(
            new CancelMigration(),
            canceledOptions(),
        )).rejects.toBeInstanceOf(OperationCanceledError);

        expect(connection.statements).toEqual([]);
    });
});
