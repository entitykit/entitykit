import type { MigrationBuilder } from '../packages/core/src/migrations/api';
import { Migration, MigrationRunner } from '../packages/core/src/migrations/api';
import {
    SqliteDatabaseConnection,
    sqliteProviderServices,
} from '../packages/sqlite/src';

class AsyncSqliteUp extends Migration {
    public readonly id = '20260804171000_AsyncSqliteUp';
    public readonly name = 'AsyncSqliteUp';

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    public override async up(builder: MigrationBuilder): Promise<void> {
        builder.createTable('before_await', [
            { name: 'id', type: 'text', primaryKey: true },
        ]);
        await Promise.resolve();
        builder.createTable('after_await', [
            { name: 'id', type: 'text', primaryKey: true },
        ]);
    }
}

class AppliedSqliteMigration extends Migration {
    public readonly id = '20260804171100_AppliedSqlite';
    public readonly name = 'AppliedSqlite';

    public override up(builder: MigrationBuilder): void {
        builder.createTable('async_down_probe', [
            { name: 'id', type: 'text', primaryKey: true },
        ]);
    }

    public override down(builder: MigrationBuilder): void {
        builder.dropTable('async_down_probe');
    }
}

class AsyncSqliteDown extends AppliedSqliteMigration {
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    public override async down(builder: MigrationBuilder): Promise<void> {
        await Promise.resolve();
        builder.dropTable('async_down_probe');
    }
}

describe('migration synchronous contract on SQLite', () => {
    it('executes neither the synchronous prefix nor migration history', async () => {
        const connection = new SqliteDatabaseConnection(':memory:');
        try {
            await expect(runner(connection).apply(new AsyncSqliteUp()))
                .rejects.toThrow('up() must be synchronous');

            const tables = await connection.query<{ name: string }>({
                text: 'select name from sqlite_master where type = \'table\'',
                values: [],
            });
            expect(tables.rows).toEqual([]);
        } finally {
            await connection.dispose();
        }
    });

    it('preserves schema and history when async down is rejected', async () => {
        const connection = new SqliteDatabaseConnection(':memory:');
        try {
            await runner(connection).apply(new AppliedSqliteMigration());

            await expect(runner(connection).revert(new AsyncSqliteDown()))
                .rejects.toThrow('down() must be synchronous');

            const table = await connection.query<{ name: string }>({
                text: 'select name from sqlite_master where type = \'table\' and name = ?',
                values: ['async_down_probe'],
            });
            const history = await connection.query<{ id: string }>({
                text: 'select id from "__entitykit_migrations" where id = ?',
                values: ['20260804171100_AppliedSqlite'],
            });
            expect(table.rows).toEqual([{ name: 'async_down_probe' }]);
            expect(history.rows).toEqual([{
                id: '20260804171100_AppliedSqlite',
            }]);
        } finally {
            await connection.dispose();
        }
    });
});

function runner(connection: SqliteDatabaseConnection): MigrationRunner {
    return new MigrationRunner(
        connection,
        sqliteProviderServices.migrationDialect,
        sqliteProviderServices.createMigrationBuilder,
    );
}
