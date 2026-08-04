import type {
    MigrationBuilder,
    MigrationBuilderFactory,
} from '../src/migrations/api';
import {
    Migration,
    MigrationBuilder as MigrationBuilderImplementation,
    migrationChecksum,
    MigrationSqlGenerator,
    MigrationRunner,
} from '../src/migrations/api';
import { RecordingDatabaseConnection } from '../src/testing';

class AsyncUpMigration extends Migration {
    public readonly id = '20260804170000_AsyncUp';
    public readonly name = 'AsyncUp';

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    public override async up(builder: MigrationBuilder): Promise<void> {
        await Promise.resolve();
        builder.createTable('async_users', [
            { name: 'id', type: 'text', primaryKey: true },
        ]);
    }
}

class PartialAsyncUpMigration extends Migration {
    public readonly id = '20260804170100_PartialAsyncUp';
    public readonly name = 'PartialAsyncUp';

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    public override async up(builder: MigrationBuilder): Promise<void> {
        builder.createSchema('before_await');
        await Promise.resolve();
        builder.createSchema('after_await');
    }
}

class AsyncDownMigration extends Migration {
    public readonly id = '20260804170200_AsyncDown';
    public readonly name = 'AsyncDown';

    public override up(builder: MigrationBuilder): void {
        builder.createTable('async_down_users', [
            { name: 'id', type: 'text', primaryKey: true },
        ]);
    }

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    public override async down(builder: MigrationBuilder): Promise<void> {
        await Promise.resolve();
        builder.dropTable('async_down_users');
    }
}

class AsyncTableCallbackMigration extends Migration {
    public readonly id = '20260804170300_AsyncTableCallback';
    public readonly name = 'AsyncTableCallback';

    public override up(builder: MigrationBuilder): void {
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        builder.createTable('async_table_users', async table => {
            table.column('id', 'text').primaryKey();
            await Promise.resolve();
            table.column('name', 'text').notNull();
        });
    }
}

describe('migration synchronous callback contract', () => {
    it('rejects async up before executing DDL or writing history', async () => {
        const connection = connectionForRejectedDefinition();

        await expect(new MigrationRunner(connection).apply(
            new AsyncUpMigration(),
        )).rejects.toMatchObject({
            name: 'MigrationError',
            details: {
                migrationId: '20260804170000_AsyncUp',
                direction: 'up',
                contractViolation: 'asyncMigrationDefinition',
            },
        });

        expectOnlyLockStatements(connection);
    });

    it('rejects the entire async definition without executing its prefix', async () => {
        const connection = connectionForRejectedDefinition();

        await expect(new MigrationRunner(connection).apply(
            new PartialAsyncUpMigration(),
        )).rejects.toThrow(
            'Migration \'20260804170100_PartialAsyncUp\' up() must be synchronous',
        );

        expectOnlyLockStatements(connection);
    });

    it('rejects async down without deleting history or reverting schema', async () => {
        const connection = connectionForRejectedDefinition();

        await expect(new MigrationRunner(connection).revert(
            new AsyncDownMigration(),
        )).rejects.toMatchObject({
            name: 'MigrationError',
            details: {
                migrationId: '20260804170200_AsyncDown',
                direction: 'down',
            },
        });

        expectOnlyLockStatements(connection);
    });

    it('rejects async definitions during checksum collection', () => {
        expect(() => migrationChecksum(new AsyncUpMigration()))
            .toThrow('Migration \'20260804170000_AsyncUp\' up() must be synchronous');
        expect(() => migrationChecksum(new AsyncDownMigration()))
            .toThrow('Migration \'20260804170200_AsyncDown\' down() must be synchronous');
    });

    it('rejects async table callbacks before migration execution', async () => {
        const connection = connectionForRejectedDefinition();

        await expect(new MigrationRunner(connection).apply(
            new AsyncTableCallbackMigration(),
        )).rejects.toMatchObject({
            name: 'MigrationError',
            details: {
                contractViolation: 'asyncMigrationTableDefinition',
            },
        });

        expectOnlyLockStatements(connection);
    });

    it('rejects an asynchronous migration builder factory', async () => {
        const factory = (async () => {
            await Promise.resolve();
            return new MigrationBuilderImplementation();
        }) as unknown as MigrationBuilderFactory;
        const generator = new MigrationSqlGenerator(undefined, factory);

        expect(() => generator.generateUpScript(new AsyncDownMigration()))
            .toThrow(
                'Migration builder factory for \'20260804170200_AsyncDown\' must be synchronous',
            );
        await new Promise<void>(resolve => setImmediate(resolve));
    });
});

function connectionForRejectedDefinition(): RecordingDatabaseConnection {
    const connection = new RecordingDatabaseConnection();
    connection.queueResult();
    connection.queueResult({ rows: [{ pg_advisory_unlock: true }] });
    return connection;
}

function expectOnlyLockStatements(connection: RecordingDatabaseConnection): void {
    expect(connection.statements.map(statement => statement.text)).toEqual([
        'select pg_advisory_lock(hashtext($1))',
        'select pg_advisory_unlock(hashtext($1))',
    ]);
    expect(connection.transactionEvents).toEqual([]);
}
