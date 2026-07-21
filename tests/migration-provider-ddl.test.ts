import { mySqlProviderServices } from '../src/providers/mysql';
import { postgresProviderServices } from '../src/providers/postgres';
import { sqliteProviderServices } from '../src/providers/sqlite';
import type { DatabaseProviderServices } from '../src/adapter';

/**
 * Provider-specific migration DDL. `alterColumn` and the constraint drops are
 * Postgres-shaped by default; MySQL and SQLite diverge, and this pins each
 * provider's output (and its honest capability errors) without a live server.
 */
const texts = (
    build: (builder: ReturnType<typeof mySqlProviderServices.createMigrationBuilder>) => void,
    provider: Pick<DatabaseProviderServices, 'createMigrationBuilder'> = mySqlProviderServices,
): string[] => {
    const builder = provider.createMigrationBuilder();
    build(builder);
    return builder.statements.map(statement => statement.text);
};

describe('MySQL migration DDL', () => {
    it('creates and alters auto-increment columns with full definitions', () => {
        const create = texts(builder => builder.createTable('widget', table => {
            table.column('id', 'integer')
                .primaryKey()
                .generatedByAutoIncrement();
        }));
        const alter = texts(builder => builder.alterColumn('widget', {
            name: 'id',
            type: 'integer',
            oldType: 'integer',
            nullable: false,
            oldNullable: false,
            storeGeneration: { kind: 'autoIncrement' },
        }));

        expect(create).toEqual([
            'create table if not exists `widget` (`id` int primary key auto_increment)',
        ]);
        expect(alter).toEqual([
            'alter table `widget` modify column `id` int not null auto_increment',
        ]);
    });

    it('alters a column by redefining it with modify column', () => {
        const statements = texts(builder => builder.alterColumn('widget', {
            name: 'size', type: 'integer', oldType: 'text',
            nullable: false, oldNullable: true,
            defaultSql: '0', oldDefaultSql: undefined,
        }));
        // Type, nullability, and default restated together — MySQL's modify drops
        // anything it does not repeat.
        expect(statements).toEqual(['alter table `widget` modify column `size` int not null default 0']);
    });

    it('restates the column type when only nullability changes', () => {
        const statements = texts(builder => builder.alterColumn('widget', {
            name: 'size', type: 'integer', oldType: 'integer', nullable: true, oldNullable: false,
        }));
        expect(statements).toEqual(['alter table `widget` modify column `size` int null']);
    });

    it('changes a default alone with the portable clause', () => {
        const statements = texts(builder => builder.alterColumn('widget', {
            name: 'size', type: 'integer', oldType: 'integer', nullable: false, oldNullable: false,
            defaultSql: '5', oldDefaultSql: undefined,
        }));
        expect(statements).toEqual(['alter table `widget` alter column `size` set default 5']);
    });

    it('drops each constraint kind with its MySQL clause', () => {
        expect(texts(builder => builder.dropPrimaryKey('widget', 'pk_widget'))).toEqual(['alter table `widget` drop primary key']);
        expect(texts(builder => builder.dropUniqueConstraint('widget', 'uq_widget_code'))).toEqual(['alter table `widget` drop index `uq_widget_code`']);
        expect(texts(builder => builder.dropForeignKey('widget', 'fk_widget_owner'))).toEqual(['alter table `widget` drop foreign key `fk_widget_owner`']);
        expect(texts(builder => builder.dropCheckConstraint('widget', 'ck_widget_size'))).toEqual(['alter table `widget` drop check `ck_widget_size`']);
    });

    it('redefines generated and collated columns', () => {
        const statements = texts(builder => builder.alterColumn('widget', {
            name: 'normalized', type: 'text', oldType: 'text',
            nullable: true, oldNullable: true,
            computedSql: 'lower(`name`)', computedStored: true,
            oldComputedSql: undefined, collation: 'utf8mb4_bin',
        }));
        expect(statements).toEqual([
            'alter table `widget` modify column `normalized` text collate `utf8mb4_bin` null generated always as (lower(`name`)) stored',
        ]);
    });

    it('rejects renameIndex, which its API cannot express for MySQL', () => {
        expect(() => texts(builder => builder.renameIndex('ix_a', 'ix_b'))).toThrow(/renameIndex/);
    });
});

describe('SQLite migration DDL', () => {
    it('renders explicit rowid reuse behavior during table creation', () => {
        const builder = sqliteProviderServices.createMigrationBuilder();
        builder.createTable('widget', [{
            name: 'id',
            type: 'integer',
            primaryKey: true,
            storeGeneration: { kind: 'rowid', preventReuse: true },
        }]);

        expect(builder.statements.map(statement => statement.text)).toEqual([
            'create table if not exists "widget" ("id" integer primary key autoincrement)',
        ]);
    });

    it('refuses to alter a column in place', () => {
        expect(() => sqliteProviderServices.createMigrationBuilder().alterColumn('widget', {
            name: 'size', type: 'integer', oldType: 'text',
        })).toThrow(/alterColumn/);
    });

    it('refuses to drop a primary key or unique constraint', () => {
        expect(() => sqliteProviderServices.createMigrationBuilder().dropPrimaryKey('widget', 'pk_widget')).toThrow(/dropPrimaryKey/);
        expect(() => sqliteProviderServices.createMigrationBuilder().dropUniqueConstraint('widget', 'uq_widget')).toThrow(/dropUniqueConstraint/);
    });

    it('refuses to change a column default alone (SQLite has no alter column)', () => {
        expect(() => sqliteProviderServices.createMigrationBuilder().alterColumn('widget', {
            name: 'size', type: 'integer', oldType: 'integer', defaultSql: '1', oldDefaultSql: undefined,
        })).toThrow(/alterColumn/);
    });

    it('refuses to rename an index', () => {
        expect(() => sqliteProviderServices.createMigrationBuilder().renameIndex('ix_a', 'ix_b')).toThrow(/renameIndex/);
    });

    it('rebuilds a complete table shape when requested by a model diff', () => {
        const builder = sqliteProviderServices.createMigrationBuilder();
        builder.rebuildTable({
            previous: {
                tableName: 'widget',
                columns: [
                    { name: 'id', type: 'text', primaryKey: true },
                    { name: 'size', type: 'text' },
                ],
                foreignKeys: [],
                checkConstraints: [],
                indexes: [],
            },
            current: {
                tableName: 'widget',
                columns: [
                    { name: 'id', type: 'text', primaryKey: true },
                    { name: 'size', type: 'integer' },
                ],
                foreignKeys: [],
                checkConstraints: [{ name: 'ck_widget_size', sql: 'size >= 0' }],
                indexes: [{
                    name: 'ix_widget_size',
                    tableName: 'widget',
                    columns: ['size'],
                    filter: 'size > 0',
                }],
            },
            copyColumns: [
                { source: 'id', target: 'id' },
                { source: 'size', target: 'size' },
            ],
            reverseCopyColumns: [
                { source: 'id', target: 'id' },
                { source: 'size', target: 'size' },
            ],
        });

        expect(builder.statements.map(statement => statement.text)).toEqual([
            'pragma defer_foreign_keys = on',
            'create table "__entitykit_new_widget" ("id" text primary key, "size" integer not null, constraint "ck_widget_size" check (size >= 0))',
            'insert into "__entitykit_new_widget" ("id", "size") select "id", "size" from "widget"',
            'drop table if exists "widget"',
            'alter table "__entitykit_new_widget" rename to "widget"',
            'create index if not exists "ix_widget_size" on "widget" ("size") where size > 0',
        ]);
    });
});

describe('Postgres migration DDL is unchanged', () => {
    it('creates and evolves first-class identity strategies', () => {
        const create = texts(builder => builder.createTable('widget', [{
            name: 'id',
            type: 'bigint',
            primaryKey: true,
            storeGeneration: {
                kind: 'identity',
                mode: 'byDefault',
                startValue: '10',
                isCyclic: false,
            },
        }]), postgresProviderServices);
        const alter = texts(builder => builder.alterColumn('widget', {
            name: 'id',
            type: 'bigint',
            oldType: 'bigint',
            nullable: false,
            oldNullable: false,
            storeGeneration: {
                kind: 'identity',
                mode: 'always',
                startValue: '10',
                isCyclic: false,
            },
            oldStoreGeneration: {
                kind: 'identity',
                mode: 'byDefault',
                startValue: '10',
                isCyclic: false,
            },
        }), postgresProviderServices);

        expect(create).toEqual([
            'create table if not exists "widget" ("id" bigint primary key generated by default as identity (start with 10))',
        ]);
        expect(alter).toEqual([
            'alter table "widget" alter column "id" set generated always',
        ]);
    });

    it('drops an ordinary default before adding identity', () => {
        const statements = texts(builder => builder.alterColumn('widget', {
            name: 'id',
            type: 'bigint',
            oldType: 'bigint',
            nullable: false,
            oldNullable: false,
            oldDefaultSql: 'nextval(\'legacy_id_seq\'::regclass)',
            storeGeneration: {
                kind: 'identity',
                mode: 'byDefault',
                isCyclic: false,
            },
        }), postgresProviderServices);

        expect(statements).toEqual([
            'alter table "widget" alter column "id" drop default',
            'alter table "widget" alter column "id" add generated by default as identity',
        ]);
    });

    it('validates raw migration generation metadata', () => {
        const builder = postgresProviderServices.createMigrationBuilder();
        expect(() => builder.createTable('widget', [{
            name: 'id',
            type: 'bigint',
            primaryKey: true,
            storeGeneration: {
                kind: 'identity',
                mode: 'byDefault',
                incrementBy: '1); drop table widget; --',
                isCyclic: false,
            },
        }])).toThrow('Identity increment must be an integer');
        expect(() => builder.createTable('widget', [{
            name: 'id',
            type: 'bigint',
            primaryKey: true,
            defaultSql: '1',
            storeGeneration: {
                kind: 'identity',
                mode: 'byDefault',
                isCyclic: false,
            },
        }])).toThrow('cannot combine store generation');
    });

    it('alters a column with independent statements', () => {
        const statements = texts(builder => builder.alterColumn('widget', {
            name: 'size', type: 'integer', oldType: 'text', nullable: false, oldNullable: true,
        }), postgresProviderServices);
        expect(statements).toEqual([
            'alter table "widget" alter column "size" type integer',
            'alter table "widget" alter column "size" set not null',
        ]);
    });

    it('drops every constraint kind with drop constraint if exists', () => {
        expect(texts(builder => builder.dropPrimaryKey('widget', 'pk_widget'), postgresProviderServices))
            .toEqual(['alter table "widget" drop constraint if exists "pk_widget"']);
        expect(texts(builder => builder.dropForeignKey('widget', 'fk_widget'), postgresProviderServices))
            .toEqual(['alter table "widget" drop constraint if exists "fk_widget"']);
    });

    it('renames an index directly', () => {
        expect(texts(builder => builder.renameIndex('ix_a', 'ix_b'), postgresProviderServices))
            .toEqual(['alter index "ix_a" rename to "ix_b"']);
    });

    it('creates sequences, checks, and rich indexes', () => {
        const builder = postgresProviderServices.createMigrationBuilder();
        builder.createSequence({
            name: 'numbers',
            schemaName: 'app',
            startValue: '100',
            incrementBy: '5',
            isCyclic: false,
        });
        builder.addCheckConstraint('widget', 'ck_widget_size', 'size >= 0');
        builder.createIndex({
            name: 'ix_widget_lower_name',
            tableName: 'widget',
            columns: [],
            keyParts: [{ kind: 'expression', expression: 'lower(name)' }],
            includedColumns: ['size'],
            filter: 'size > 0',
        });

        expect(builder.statements.map(statement => statement.text)).toEqual([
            'create sequence if not exists "app"."numbers" increment by 5 start with 100 no cycle',
            'alter table "widget" add constraint "ck_widget_size" check (size >= 0)',
            'create index if not exists "ix_widget_lower_name" on "widget" (lower(name)) include ("size") where size > 0',
        ]);
    });

    it('fully resets omitted sequence options and rejects unsafe integer text', () => {
        const builder = postgresProviderServices.createMigrationBuilder();
        builder.alterSequence(
            { name: 'numbers', incrementBy: '-2', isCyclic: false },
            {
                name: 'numbers',
                dataType: 'integer',
                startValue: '10',
                incrementBy: '5',
                minValue: '10',
                maxValue: '100',
                cache: 20,
                isCyclic: true,
            },
        );

        expect(builder.statements.map(statement => statement.text)).toEqual([
            'alter sequence "numbers" as bigint increment by -2 no minvalue no maxvalue start with -1 cache 1 no cycle',
        ]);
        expect(() => builder.createSequence({
            name: 'unsafe',
            startValue: '1; drop table users',
        })).toThrow('Sequence start value must be an integer');
    });
});
