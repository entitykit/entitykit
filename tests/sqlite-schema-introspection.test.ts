import { requireDefined } from './support/require-defined';
import { generateDbPullCode } from '../packages/core/src/tooling';
import { SqliteDatabaseConnection, SqliteSchemaIntrospector } from '../packages/sqlite/src';

describe('SQLite schema introspection', () => {
    let connection: SqliteDatabaseConnection;

    beforeEach(async () => {
        connection = new SqliteDatabaseConnection(':memory:');
        await connection.query({ text: 'create table "author" ("id" text primary key, "name" text not null)', values: [] });
        await connection.query({
            text: 'create table "post" ("id" text primary key, "title" text, "author_id" text references "author" ("id") on delete cascade)',
            values: [],
        });
        await connection.query({ text: 'create unique index "ix_post_title" on "post" ("title")', values: [] });
    });

    afterEach(async () => {
        await connection.dispose();
    });

    it('introspects tables, columns, primary keys, indexes, and foreign keys', async () => {
        const snapshot = await new SqliteSchemaIntrospector(connection).introspect();

        // SQLite's implicit `main` database is reported as an empty schema, so a
        // pulled model stays unqualified (SQLite has no `create schema`).
        expect(snapshot.schemas.map(schema => schema.name)).toEqual(['']);
        const tables = snapshot.schemas[0].tables;
        expect(tables.map(table => table.tableName)).toEqual(['author', 'post']);

        const post = requireDefined(tables.find(table => table.tableName === 'post'));
        expect(post.columns.map(column => ({ name: column.name, storeType: column.storeType, isNullable: column.isNullable }))).toEqual([
            { name: 'id', storeType: 'text', isNullable: false },
            { name: 'title', storeType: 'text', isNullable: true },
            { name: 'author_id', storeType: 'text', isNullable: true },
        ]);
        expect(post.primaryKey?.columns).toEqual(['id']);
        expect(post.indexes).toEqual([
            {
                name: 'ix_post_title',
                columns: ['title'],
                keyParts: [{ kind: 'column', name: 'title' }],
                isUnique: true,
                filter: undefined,
                unsupportedFeatures: undefined,
            },
        ]);
        expect(post.foreignKeys).toEqual([
            {
                name: 'post_author_0_fkey',
                columns: ['author_id'],
                principalSchemaName: '',
                principalTableName: 'author',
                principalColumns: ['id'],
                onDelete: 'cascade',
            },
        ]);
    });

    it('resolves an implicit foreign key reference to the target primary key', async () => {
        await connection.query({
            text: 'create table "child" ("id" text primary key, "author_id" text references "author")',
            values: [],
        });

        const snapshot = await new SqliteSchemaIntrospector(connection).introspect();
        const child = requireDefined(snapshot.schemas[0].tables.find(table => table.tableName === 'child'));

        expect(child.foreignKeys[0]?.principalTableName).toBe('author');
        expect(child.foreignKeys[0]?.principalColumns).toEqual(['id']);
    });

    it('returns an empty snapshot when the main schema is filtered out', async () => {
        const snapshot = await new SqliteSchemaIntrospector(connection).introspect({ schemas: ['public'] });
        expect(snapshot.schemas).toEqual([]);
    });

    it('preserves partial-index predicates instead of widening them', async () => {
        await connection.query({
            text: 'create index "ix_post_title_present" on "post" ("title") where "title" is not null',
            values: [],
        });

        const snapshot = await new SqliteSchemaIntrospector(connection).introspect();
        const post = requireDefined(snapshot.schemas[0].tables.find(
            table => table.tableName === 'post',
        ));

        expect(post.indexes).toContainEqual({
            name: 'ix_post_title_present',
            columns: ['title'],
            keyParts: [{ kind: 'column', name: 'title' }],
            isUnique: false,
            filter: '"title" is not null',
            unsupportedFeatures: undefined,
        });
    });

    it('preserves views, checks, generated columns, collations, and expression indexes', async () => {
        await connection.query({
            text: `create table "metric" (
                "id" integer primary key,
                "name" text collate nocase,
                "value" integer not null,
                "label" text check ("label" <> 'a,b'),
                "doubled" integer generated always as ("value" * 2) stored,
                constraint "ck_pulled_1" check ("value" >= 0)
            )`,
            values: [],
        });
        await connection.query({
            text: 'create index "ix_metric_name_positive" on "metric" (lower("name")) where "value" > 0',
            values: [],
        });
        await connection.query({
            text: 'create view "metric_totals" as select sum("value") as "total" from "metric"',
            values: [],
        });

        const snapshot = await new SqliteSchemaIntrospector(connection).introspect();
        const metric = requireDefined(snapshot.schemas[0].tables.find(
            table => table.tableName === 'metric',
        ));
        const view = requireDefined(snapshot.schemas[0].tables.find(
            table => table.tableName === 'metric_totals',
        ));

        expect(metric.columns).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'name', collation: 'nocase' }),
            expect.objectContaining({
                name: 'doubled',
                generatedExpression: '"value" * 2',
                generatedStored: true,
            }),
        ]));
        expect(metric.checkConstraints).toEqual([
            { name: 'ck_pulled_2', sql: '"label" <> \'a,b\'' },
            { name: 'ck_pulled_1', sql: '"value" >= 0' },
        ]);
        expect(metric.indexes).toContainEqual(expect.objectContaining({
            name: 'ix_metric_name_positive',
            keyParts: [{ kind: 'expression', expression: 'lower("name")' }],
            filter: '"value" > 0',
        }));
        expect(view.objectType).toBe('view');

        const generated = generateDbPullCode(snapshot)
            .map(file => file.contents)
            .join('\n');
        expect(generated).toContain('entity.toView("metric_totals")');
        expect(generated).toContain('.hasComputedColumnSql("\\"value\\" * 2", true)');
        expect(generated).toContain('.useCollation("nocase")');
        expect(generated).toContain('hasCheckConstraint("ck_pulled_1"');
        expect(generated).toContain('hasExpressionIndex(["lower(\\"name\\")"])');
        expect(generated).toContain('.hasFilter("\\"value\\" > 0")');
    });

    it('feeds the provider-neutral db pull codegen', async () => {
        const snapshot = await new SqliteSchemaIntrospector(connection).introspect();
        const files = generateDbPullCode(snapshot);
        const combined = files.map(file => file.contents).join('\n');

        expect(files.length).toBeGreaterThan(0);
        expect(combined).toContain('author');
        expect(combined).toContain('post');
    });

    it('scaffolds foreign keys to table-level unique constraints', async () => {
        await connection.query({
            text: 'create table "tenant" ("id" text primary key, "code" text unique)',
            values: [],
        });
        await connection.query({
            text: 'create table "membership" ("id" text primary key, "tenant_code" text references "tenant" ("code"))',
            values: [],
        });

        const snapshot = await new SqliteSchemaIntrospector(connection).introspect();
        const combined = generateDbPullCode(snapshot)
            .map(file => file.contents)
            .join('\n');

        expect(combined).toContain(
            'hasAlternateKey(row => row.code).hasDatabaseName("ux_tenant_code")',
        );
        expect(combined).toContain('hasPrincipalKey(row => row.code)');
    });
});
