import { requireDefined } from '../support/require-defined';
import type { MigrationBuilder } from '../../packages/core/src/migrations/api';
import { Migration, MigrationRunner } from '../../packages/core/src/migrations/api';
import { PostgresDatabaseConnection } from '../../packages/postgres/src';

const shouldRunPostgresTests = process.env.RUN_POSTGRES_TESTS === 'true' && Boolean(process.env.DATABASE_URL);
const describePostgres = shouldRunPostgresTests ? describe : describe.skip;

class CreateMigrationUsers extends Migration {
    public readonly id = '20260601190000_CreateMigrationUsers';
    public readonly name = 'CreateMigrationUsers';

    public override up(builder: MigrationBuilder): void {
        builder.createTable('entitykit_migration_users', table => {
            table.column('id', 'text').primaryKey();
            table.column('email', 'text').notNull();
        });
    }

    public override down(builder: MigrationBuilder): void {
        builder.dropTable('entitykit_migration_users');
    }
}

class AddDisplayNameToMigrationUsers extends Migration {
    public readonly id = '20260601190100_AddDisplayNameToMigrationUsers';
    public readonly name = 'AddDisplayNameToMigrationUsers';

    public override up(builder: MigrationBuilder): void {
        builder.addColumn('entitykit_migration_users', {
            name: 'display_name',
            type: 'text',
            nullable: false,
            defaultSql: '\'Unknown\'',
        });
        builder.createIndex({
            name: 'ix_entitykit_migration_users_email',
            tableName: 'entitykit_migration_users',
            columns: ['email'],
            unique: true,
        });
    }

    public override down(builder: MigrationBuilder): void {
        builder.dropIndex('ix_entitykit_migration_users_email');
        builder.dropColumn('entitykit_migration_users', 'display_name');
    }
}

describePostgres('Postgres migrations integration', () => {
    let connection: PostgresDatabaseConnection;

    beforeEach(async () => {
        connection = new PostgresDatabaseConnection(requireDefined(process.env.DATABASE_URL));
        await connection.query({ text: 'drop table if exists "entitykit_migration_users" cascade', values: [] });
        await connection.query({ text: 'drop table if exists "__entitykit_migrations" cascade', values: [] });
    });

    afterEach(async () => {
        await connection.dispose();
    });

    it('applies migrations, records history, and is idempotent on the second update', async () => {
        const runner = new MigrationRunner(connection);
        const migrations = [new CreateMigrationUsers(), new AddDisplayNameToMigrationUsers()];

        const first = await runner.update(migrations);
        expect(first.appliedMigrations).toEqual([
            'up:20260601190000_CreateMigrationUsers',
            'up:20260601190100_AddDisplayNameToMigrationUsers',
        ]);

        const table = await connection.query<{ display_name: string }>({
            text: 'insert into "entitykit_migration_users" ("id", "email") values ($1, $2) returning "display_name"',
            values: ['usr_1', 'migration@example.com'],
        });
        expect(table.rows[0]?.display_name).toBe('Unknown');

        const history = await runner.getAppliedMigrations();
        expect(history.map(row => row.id)).toEqual(migrations.map(migration => migration.id));
        expect(history.every(row => row.checksum.length === 64)).toBe(true);

        const second = await runner.update(migrations);
        expect(second.appliedMigrations).toEqual([]);
    });
});
