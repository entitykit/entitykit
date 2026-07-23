import { requireDefined } from '../support/require-defined';
import type { MigrationBuilder } from '../../src/migrations/api';
import { Migration, MigrationRunner } from '../../src/migrations/api';
import { MySqlDatabaseConnection, mySqlProviderServices } from '../../src/providers/mysql';
import {
    containing,
    stringContaining,
} from '../support/jest-asymmetric-matchers';

const url = process.env.MYSQL_URL ?? process.env.MYSQL_DATABASE_URL;
const shouldRun = process.env.RUN_MYSQL_TESTS === 'true' && Boolean(url);
const maybe = shouldRun ? describe : describe.skip;

/**
 * The migration operations that are Postgres-shaped by default, run against live
 * MySQL. Each of alterColumn, dropUniqueConstraint, dropForeignKey,
 * and dropIndex emitted DDL MySQL rejects at parse time before the dialect
 * learned its forms; this applies and rolls back a migration that uses them all.
 */
class EvolveWidgets extends Migration {
    public readonly id = '20260101000001_EvolveWidgets';
    public readonly name = 'EvolveWidgets';

    public override up(builder: MigrationBuilder): void {
        builder.createTable('mig_owner', [{ name: 'id', type: 'integer', primaryKey: true }]);
        builder.createTable('mig_widget', [
            { name: 'id', type: 'integer', primaryKey: true },
            { name: 'code', type: 'varchar(64)', nullable: false },
            { name: 'size', type: 'integer', nullable: true },
            { name: 'owner_id', type: 'integer', nullable: true },
        ]);
        // Redefine size to NOT NULL DEFAULT 0 — MySQL needs `modify column`.
        builder.alterColumn('mig_widget', { name: 'size', type: 'integer', oldType: 'integer', nullable: false, oldNullable: true, defaultSql: '0' });
        builder.addUniqueConstraint('mig_widget', 'uq_widget_code', ['code']);
        builder.addForeignKey({ name: 'fk_widget_owner', tableName: 'mig_widget', columns: ['owner_id'], principalTableName: 'mig_owner', principalColumns: ['id'], onDelete: 'set null' });
        builder.createIndex({ name: 'ix_widget_size', tableName: 'mig_widget', columns: ['size'] });
    }

    public override down(builder: MigrationBuilder): void {
        builder.dropIndex('ix_widget_size', undefined, { tableName: 'mig_widget' });
        builder.dropForeignKey('mig_widget', 'fk_widget_owner');
        builder.dropUniqueConstraint('mig_widget', 'uq_widget_code');
        builder.alterColumn('mig_widget', { name: 'size', type: 'integer', oldType: 'integer', nullable: true, oldNullable: false, defaultSql: undefined, oldDefaultSql: '0' });
        builder.dropTable('mig_widget');
        builder.dropTable('mig_owner');
    }
}

class PartialDdlFailure extends Migration {
    public readonly id = '20260101000002_PartialDdlFailure';
    public readonly name = 'PartialDdlFailure';

    public override up(builder: MigrationBuilder): void {
        builder.createTable('mig_partial', [
            { name: 'id', type: 'integer', primaryKey: true },
        ]);
        builder.sql('insert into mig_missing (id) values (?)', [1]);
    }

    public override down(builder: MigrationBuilder): void {
        builder.dropTable('mig_partial');
    }
}

maybe('MySQL migration operations', () => {
    let connection: MySqlDatabaseConnection;

    const dropAll = async (): Promise<void> => {
        await connection.query({ text: 'drop table if exists mig_partial', values: [] });
        await connection.query({ text: 'drop table if exists mig_widget', values: [] });
        await connection.query({ text: 'drop table if exists mig_owner', values: [] });
        await connection.query({ text: 'drop table if exists __entitykit_migrations', values: [] });
    };

    const scalar = async (text: string): Promise<unknown> => {
        const result = await connection.query<{ value: unknown }>({ text, values: [] });
        return result.rows[0]?.value;
    };

    beforeEach(async () => {
        connection = new MySqlDatabaseConnection(requireDefined(url));
        await dropAll();
    });

    afterEach(async () => {
        await dropAll();
        await connection.dispose();
    });

    it('applies and rolls back a migration using every Postgres-shaped operation', async () => {
        const runner = new MigrationRunner(connection, mySqlProviderServices.migrationDialect, mySqlProviderServices.createMigrationBuilder);

        await runner.update([new EvolveWidgets()]);

        // The alterColumn redefinition took: size is NOT NULL with a default of 0.
        expect(await scalar('select is_nullable as value from information_schema.columns where table_schema = database() and table_name = \'mig_widget\' and column_name = \'size\'')).toBe('NO');
        expect(String(await scalar('select column_default as value from information_schema.columns where table_schema = database() and table_name = \'mig_widget\' and column_name = \'size\''))).toBe('0');
        // The unique constraint, foreign key, and index all exist.
        expect(Number(await scalar('select count(*) as value from information_schema.statistics where table_schema = database() and table_name = \'mig_widget\' and index_name = \'uq_widget_code\''))).toBeGreaterThan(0);
        expect(Number(await scalar('select count(*) as value from information_schema.table_constraints where table_schema = database() and table_name = \'mig_widget\' and constraint_name = \'fk_widget_owner\''))).toBe(1);
        expect(Number(await scalar('select count(*) as value from information_schema.statistics where table_schema = database() and table_name = \'mig_widget\' and index_name = \'ix_widget_size\''))).toBeGreaterThan(0);

        // A default row honors the new default, proving the column is usable.
        await connection.query({ text: 'insert into mig_widget (id, code) values (1, \'a\')', values: [] });
        expect(Number(await scalar('select size as value from mig_widget where id = 1'))).toBe(0);

        await runner.update([new EvolveWidgets()], { target: '0' });

        // Everything the down() dropped is gone, and history is empty.
        expect(Number(await scalar('select count(*) as value from information_schema.tables where table_schema = database() and table_name = \'mig_widget\''))).toBe(0);
        expect(Number(await scalar('select count(*) as value from information_schema.tables where table_schema = database() and table_name = \'mig_owner\''))).toBe(0);
        expect(Number(await scalar('select count(*) as value from __entitykit_migrations'))).toBe(0);
    });

    it('reports and preserves visible DDL when later transactional work fails', async () => {
        const migration = new PartialDdlFailure();
        const runner = new MigrationRunner(
            connection,
            mySqlProviderServices.migrationDialect,
            mySqlProviderServices.createMigrationBuilder,
        );

        await expect(runner.update([migration])).rejects.toMatchObject({
            name: 'MigrationExecutionError',
            details: containing({
                migrationId: migration.id,
                transactionMode:
          'mixed transactional and transaction-suppressed statements',
                transactionSuppressedStatements: 1,
                nextAction: stringContaining(
                    'inspect the database for partial transaction-suppressed work',
                ),
            }),
        });

        expect(Number(await scalar(
            'select count(*) as value from information_schema.tables where table_schema = database() and table_name = \'mig_partial\'',
        ))).toBe(1);
        expect(Number(await scalar(
            `select count(*) as value from __entitykit_migrations where id = '${migration.id}'`,
        ))).toBe(0);
    });
});
