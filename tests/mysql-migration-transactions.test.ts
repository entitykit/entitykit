import type {
    MigrationBuilder } from '../packages/core/src/migrations/api';
import {
    Migration,
    MigrationRunner,
    MigrationSqlGenerator,
} from '../packages/core/src/migrations/api';
import { mySqlProviderServices } from '../packages/mysql/src';
import { RecordingDatabaseConnection } from '../packages/testing/src';
import {
    containing,
    stringContaining,
} from './support/jest-asymmetric-matchers';

class MixedMySqlMigration extends Migration {
    public readonly id = '20260729000004_MixedMySql';
    public readonly name = 'MixedMySql';

    public override up(builder: MigrationBuilder): void {
        builder.createTable('items', [
            { name: 'id', type: 'integer', primaryKey: true },
        ]);
        builder.sql('insert into items (id) values (?)', [1]);
    }

    public override down(builder: MigrationBuilder): void {
        builder.dropTable('items');
    }
}

const generator = (): MigrationSqlGenerator => new MigrationSqlGenerator(
    mySqlProviderServices.migrationDialect,
    mySqlProviderServices.createMigrationBuilder,
);

describe('MySQL migration transaction semantics', () => {
    it('marks every supported high-level DDL helper as transaction-suppressed', () => {
        const builder = mySqlProviderServices.createMigrationBuilder();

        builder.createSchema('app');
        builder.dropSchema('app');
        builder.createTable('items', [
            { name: 'id', type: 'integer', primaryKey: true },
        ]);
        builder.dropTable('items');
        builder.renameTable('items', 'renamed_items');
        builder.addColumn('items', { name: 'name', type: 'text' });
        builder.dropColumn('items', 'name');
        builder.renameColumn('items', 'name', 'label');
        builder.alterColumn('items', {
            name: 'label',
            type: 'varchar(64)',
            oldType: 'text',
            nullable: false,
            oldNullable: true,
        });
        builder.addPrimaryKey('items', 'pk_items', ['id']);
        builder.dropPrimaryKey('items', 'pk_items');
        builder.addUniqueConstraint('items', 'uq_items_label', ['label']);
        builder.dropUniqueConstraint('items', 'uq_items_label');
        builder.addForeignKey({
            name: 'fk_items_owner',
            tableName: 'items',
            columns: ['owner_id'],
            principalTableName: 'owners',
            principalColumns: ['id'],
        });
        builder.dropForeignKey('items', 'fk_items_owner');
        builder.createIndex({
            name: 'ix_items_label',
            tableName: 'items',
            columns: ['label'],
        });
        builder.dropIndex('ix_items_label', undefined, { tableName: 'items' });

        expect(builder.statements).toHaveLength(17);
        expect(builder.statements.every(
            statement => statement.suppressTransaction === true,
        )).toBe(true);
    });

    it('suppresses generated DDL but keeps raw data and history writes transactional', () => {
        const statements = generator().buildUpStatements(
            new MixedMySqlMigration(),
        );

        expect(statements.map(statement => ({
            text: statement.text,
            suppressed: statement.suppressTransaction ?? false,
        }))).toEqual([
            {
                text: stringContaining('create table if not exists'),
                suppressed: true,
            },
            {
                text: stringContaining('create table if not exists `items`'),
                suppressed: true,
            },
            {
                text: 'insert into items (id) values (?)',
                suppressed: false,
            },
            {
                text: stringContaining('insert into `__entitykit_migrations`'),
                suppressed: false,
            },
        ]);
    });

    it('reports partial-work recovery when a data statement fails after DDL', async () => {
        const connection = new RecordingDatabaseConnection();
        const failure = new Error('insert failed');
        connection.queueResult({ rows: [{ acquired: 1 }] });
        connection.queueResult();
        connection.queueResult();
        connection.queueError(failure);
        connection.queueResult({ rows: [{ released: 1 }] });

        await expect(new MigrationRunner(
            connection,
            mySqlProviderServices.migrationDialect,
            mySqlProviderServices.createMigrationBuilder,
        ).apply(new MixedMySqlMigration())).rejects.toMatchObject({
            name: 'MigrationExecutionError',
            cause: failure,
            details: containing({
                transactionSuppressedStatements: 2,
                transactionMode:
          'mixed transactional and transaction-suppressed statements',
            }),
            message: stringContaining(
                'inspect the database for partial transaction-suppressed work',
            ),
        });

        expect(connection.transactionEvents).toEqual(['begin', 'rollback']);
    });
});
