import { requireDefined } from '../support/require-defined';
import type { DatabaseQueryResult } from '../../packages/core/src';
import type {
    MigrationBuilder } from '../../packages/core/src/migrations/api';
import {
    Migration,
    MigrationRunner,
} from '../../packages/core/src/migrations/api';
import {
    MySqlDatabaseConnection,
    mySqlProviderServices,
} from '../../packages/mysql/src';

const url = process.env.MYSQL_URL ?? process.env.MYSQL_DATABASE_URL;
const shouldRun = process.env.RUN_MYSQL_TESTS === 'true' && Boolean(url);
const describeMysql = shouldRun ? describe : describe.skip;

class CreateLockProbe extends Migration {
    public readonly id = '20260729120000_CreateLockProbe';
    public readonly name = 'CreateLockProbe';

    public override up(builder: MigrationBuilder): void {
        builder.createTable('entitykit_lock_probe', [
            { name: 'id', type: 'integer', primaryKey: true },
        ]);
    }

    public override down(builder: MigrationBuilder): void {
        builder.dropTable('entitykit_lock_probe');
    }
}

describeMysql('MySQL migration lock integration', () => {
    it('serializes two runners and applies a migration exactly once', async () => {
        const first = new MySqlDatabaseConnection(requireDefined(url));
        const second = new MySqlDatabaseConnection(requireDefined(url));
        const query = async (text: string): Promise<DatabaseQueryResult> => first.query({ text, values: [] });

        try {
            await query('drop table if exists entitykit_lock_probe');
            await query('drop table if exists __entitykit_migrations');

            const runner = (connection: MySqlDatabaseConnection): MigrationRunner =>
                new MigrationRunner(
                    connection,
                    mySqlProviderServices.migrationDialect,
                    mySqlProviderServices.createMigrationBuilder,
                );
            const migration = new CreateLockProbe();
            const results = await Promise.all([
                runner(first).update([migration]),
                runner(second).update([migration]),
            ]);

            expect(
                results.reduce(
                    (count, result) => count + result.appliedMigrations.length,
                    0,
                ),
            ).toBe(1);
            expect(results.every(result => result.usedMigrationLock)).toBe(true);

            const history = await first.query<{ id: string }>({
                text: 'select `id` from `__entitykit_migrations` order by `id`',
                values: [],
            });
            expect(history.rows).toEqual([
                { id: '20260729120000_CreateLockProbe' },
            ]);

            const tables = await first.query<{ count: number | string }>({
                text: 'select count(*) as `count` from information_schema.tables where table_schema = database() and table_name = \'entitykit_lock_probe\'',
                values: [],
            });
            expect(Number(tables.rows[0]?.count)).toBe(1);
        } finally {
            await query('drop table if exists entitykit_lock_probe');
            await query('drop table if exists __entitykit_migrations');
            await first.dispose();
            await second.dispose();
        }
    });
});
