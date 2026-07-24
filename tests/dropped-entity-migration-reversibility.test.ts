import type {
    DbContextOptionsBuilder,
    ModelBuilder } from '../src';
import { DbContext, DeleteBehavior } from '../src';
import { type ModelSnapshot } from '../src/tooling';
import {
    diffModelSnapshots,
    contextMigrations,
    MigrationSqlGenerator,
} from '../src/migrations/api';
import { renderMigrationSource } from '../src/migrations/migration-scaffold-render';
import { sqliteProviderServices } from '../src/providers/sqlite';

class Owner {
    public id!: string;
    public widgets!: Widget[];
}

class Widget {
    public id!: string;
    public ownerId!: string;
    public code!: string;
    public label!: string;
    public owner!: Owner;
}

function contextWithWidget(includeWidget: boolean): { create(): DbContext } {
    return class DroppedEntityDbContext extends DbContext {
        public owners = this.set(Owner);
        public widgets = this.set(Widget);

        protected override configure(options: DbContextOptionsBuilder): void {
            options.useProvider(sqliteProviderServices, ':memory:');
        }

        protected override model(model: ModelBuilder): void {
            model.entity(Owner, entity => {
                entity.toTable('owners');
                entity.hasKey(owner => owner.id);
                entity.property(owner => owner.id).hasColumnName('id').hasColumnType('text').isRequired();
            });

            if (!includeWidget) {
                return;
            }

            model.entity(Widget, entity => {
                entity.toTable('widgets');
                entity.hasKey(widget => widget.id);
                entity.property(widget => widget.id).hasColumnName('id').hasColumnType('text').isRequired();
                entity.property(widget => widget.ownerId).hasColumnName('owner_id').hasColumnType('text').isRequired();
                entity.property(widget => widget.code).hasColumnName('code').hasColumnType('text').isRequired().isUnique();
                entity.property(widget => widget.label).hasColumnName('label').hasColumnType('text').isRequired();
                entity.hasIndex(widget => widget.ownerId)
                    .hasDatabaseName('ix_widgets_owner_id');
                entity.hasOne(Owner, widget => widget.owner)
                    .withMany(owner => owner.widgets)
                    .hasForeignKey(widget => widget.ownerId)
                    .onDelete(DeleteBehavior.Cascade)
                    .hasConstraintName('fk_widgets_owners_owner_id');
            });
        }
    };
}

const emptySnapshot: ModelSnapshot = {
    formatVersion: 1,
    entities: [],
};

describe('dropped entity migration reversibility', () => {
    it('captures indexes, unique indexes, and foreign keys before dropping a table', async () => {
        const WithWidget = contextWithWidget(true);
        const WithoutWidget = contextWithWidget(false);
        const before =  WithWidget.create();
        const after =  WithoutWidget.create();

        const operations = diffModelSnapshots(
            contextMigrations(before).createModelSnapshot(),
            contextMigrations(after).createModelSnapshot(),
        ).operations;

        expect(operations.map(operation => operation.kind)).toEqual([
            'dropForeignKey',
            'dropIndex',
            'dropIndex',
            'dropTable',
        ]);
        expect(operations).toMatchObject([
            {
                kind: 'dropForeignKey',
                name: 'fk_widgets_owners_owner_id',
                tableName: 'widgets',
                columns: ['owner_id'],
                principalTableName: 'owners',
                principalColumns: ['id'],
                onDelete: 'cascade',
            },
            {
                kind: 'dropIndex',
                name: 'ix_widgets_owner_id',
                tableName: 'widgets',
                columns: ['owner_id'],
                unique: false,
            },
            {
                kind: 'dropIndex',
                name: 'ux_widgets_code',
                tableName: 'widgets',
                columns: ['code'],
                unique: true,
            },
            {
                kind: 'dropTable',
                tableName: 'widgets',
            },
        ]);

        await before.dispose();
        await after.dispose();
    });

    it('restores the complete SQLite table shape after up then down', async () => {
        const WithWidget = contextWithWidget(true);
        const WithoutWidget = contextWithWidget(false);
        const db =  WithWidget.create();
        const target =  WithoutWidget.create();
        const generator = new MigrationSqlGenerator(
            contextOptions(db).migrationDialect,
            contextOptions(db).createMigrationBuilder,
        );
        const run = async (
            statements: ReadonlyArray<{ text: string; values: readonly unknown[] }>,
        ): Promise<void> => {
            for (const statement of statements) {
                if (!statement.text.includes('__entitykit_migrations')) {
                    await db.database.connection.query(statement);
                }
            }
        };

        const beforeSnapshot = contextMigrations(db).createModelSnapshot();
        await run(generator.buildUpStatements(
            diffModelSnapshots(emptySnapshot, beforeSnapshot)
                .toMigration('1_WithWidget', 'WithWidget'),
        ));

        const removal = diffModelSnapshots(
            beforeSnapshot,
            contextMigrations(target).createModelSnapshot(),
        ).toMigration('2_DropWidget', 'DropWidget');
        await run(generator.buildUpStatements(removal));

        const dropped = await db.database.connection.query<{ name: string }>({
            text: 'select name from sqlite_master where type = \'table\' and name = \'widgets\'',
            values: [],
        });
        expect(dropped.rows).toEqual([]);

        await run(generator.buildDownStatements(removal));

        const columns = await db.database.connection.query<{ name: string }>({
            text: 'pragma table_info("widgets")',
            values: [],
        });
        expect(columns.rows.map(row => row.name).sort()).toEqual([
            'code',
            'id',
            'label',
            'owner_id',
        ]);

        const indexes = await db.database.connection.query<{ name: string; unique: number }>({
            text: 'pragma index_list("widgets")',
            values: [],
        });
        expect(indexes.rows).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'ix_widgets_owner_id', unique: 0 }),
            expect.objectContaining({ name: 'ux_widgets_code', unique: 1 }),
        ]));

        const foreignKeys = await db.database.connection.query<{
            table: string;
            from: string;
            to: string;
            on_delete: string;
        }>({
            text: 'pragma foreign_key_list("widgets")',
            values: [],
        });
        expect(foreignKeys.rows).toEqual([
            expect.objectContaining({
                table: 'owners',
                from: 'owner_id',
                to: 'id',
                on_delete: 'CASCADE',
            }),
        ]);

        const table = await db.database.connection.query<{ sql: string }>({
            text: 'select sql from sqlite_master where type = \'table\' and name = \'widgets\'',
            values: [],
        });
        expect(table.rows[0]?.sql).toContain(
            'constraint "fk_widgets_owners_owner_id"',
        );

        await db.dispose();
        await target.dispose();
    });

    it('renders a generated down migration with reversible indexes and inline foreign keys', async () => {
        const WithWidget = contextWithWidget(true);
        const WithoutWidget = contextWithWidget(false);
        const before =  WithWidget.create();
        const after =  WithoutWidget.create();
        const previousSnapshot = contextMigrations(before).createModelSnapshot();
        const targetSnapshot = contextMigrations(after).createModelSnapshot();
        const operations = diffModelSnapshots(
            previousSnapshot,
            targetSnapshot,
        ).operations;

        const source = renderMigrationSource({
            id: '2_DropWidget',
            className: 'DropWidget',
            previousSnapshot,
            targetSnapshot,
            operations,
            warnings: [],
        });

        expect(source).toContain('"foreignKeys": [');
        expect(source).toContain('"name": "fk_widgets_owners_owner_id"');
        expect(source).toContain('"name": "ix_widgets_owner_id"');
        expect(source).toContain('"name": "ux_widgets_code"');
        expect(source).toContain('"unique": true');
        expect(source).not.toContain('Dropped index cannot be restored');

        await before.dispose();
        await after.dispose();
    });
});
import { contextOptions } from './support/public-api-internals';
