import { requireDefined } from './support/require-defined';
import { generateDbPullCode, type DatabaseSchemaSnapshot } from '../packages/core/src/tooling';
import * as sqliteProvider from '../packages/sqlite/src';
import { SqliteDatabaseConnection, SqliteSchemaIntrospector } from '../packages/sqlite/src';
import { loadGeneratedDbContext } from './support/load-generated-db-context';

/**
 * The db pull round-trip guarantee, proven in-process for SQLite: introspect an
 * EntityKit-created schema, generate model code, apply *that* code's DDL to a
 * clean database, and re-introspect to identical store types. This is the same
 * guarantee the live MySQL test asserts, here without a server —
 * it catches a generated model that cannot recreate its own schema.
 */

function columnShape(snapshot: DatabaseSchemaSnapshot, tableName: string): Array<{ name: string; storeType: string; isNullable: boolean; }> | undefined {
    const table = snapshot.schemas.flatMap(schema => schema.tables).find(candidate => candidate.tableName === tableName);
    return table?.columns.map(column => ({ name: column.name, storeType: column.storeType, isNullable: column.isNullable }));
}

describe('SQLite db pull round-trip', () => {
    let connection: SqliteDatabaseConnection;

    beforeEach(async () => {
        connection = new SqliteDatabaseConnection(':memory:');
        await connection.query({ text: 'create table "author" ("id" text primary key, "code" text not null, "name" text not null)', values: [] });
        await connection.query({ text: 'create unique index "ux_author_code" on "author" ("code")', values: [] });
        await connection.query({
            text: 'create table "post" ("id" text primary key, "title" text, "views" integer not null, "author_code" text references "author" ("code") on delete cascade)',
            values: [],
        });
        await connection.query({ text: 'create index "ix_post_views" on "post" ("views")', values: [] });
    });

    afterEach(async () => {
        await connection.dispose();
    });

    it('regenerates a schema whose generated model recreates it losslessly', async () => {
        const snapshot = await new SqliteSchemaIntrospector(connection).introspect();

        const contextName = 'PulledSqliteContext';
        const files = generateDbPullCode(snapshot, {
            contextName,
            providerName: 'sqlite',
            connectionStringExpression: JSON.stringify(':memory:'),
        });

        const contextFile = requireDefined(files.find(file =>
            file.path === 'pulled-sqlite-context.ts',
        )).contents;
        expect(contextFile).toContain('import { sqliteProviderServices } from "entitykit/sqlite";');
        expect(contextFile).toContain('options.useProvider(sqliteProviderServices,');
        // SQLite has no CREATE SCHEMA, and "main" is the implicit database, so the
        // generated model must not qualify tables or it cannot recreate itself.
        expect(contextFile).not.toContain('create schema');
        expect(contextFile).toContain('entity.toTable("post");');
        expect(contextFile).toContain(
            'entity.hasAlternateKey(row => row.code).hasDatabaseName("ux_author_code")',
        );
        expect(contextFile).toContain('.hasPrincipalKey(row => row.code)');

        // Apply the *generated* model's DDL to a clean in-memory database and
        // re-introspect: the store types must match the original pull.
        const generated = loadGeneratedDbContext(files, contextName, { 'entitykit/sqlite': sqliteProvider });
        const pulled = await generated.create();
        try {
            const script = pulled.database.createScript();
            expect(script).not.toContain('create schema');
            await pulled.database.connection.query({ text: script, values: [] });

            const roundTrip = await new SqliteSchemaIntrospector(
                pulled.database.connection,
            ).introspect();
            expect(columnShape(roundTrip, 'author')).toEqual(columnShape(snapshot, 'author'));
            expect(columnShape(roundTrip, 'post')).toEqual(columnShape(snapshot, 'post'));
            const post = requireDefined(roundTrip.schemas.flatMap(schema => schema.tables).find(table => table.tableName === 'post'));
            expect(post.foreignKeys.map(fk => fk.principalTableName)).toEqual(['author']);
            expect(post.foreignKeys[0]?.principalColumns).toEqual(['code']);
            expect(post.indexes.map(index => index.columns)).toContainEqual(['views']);
        } finally {
            await pulled.dispose();
        }
    });

    it('round-trips SQLite rowid reuse semantics', async () => {
        await connection.query({
            text: 'create table "counter" ("id" integer primary key autoincrement, "label" text not null)',
            values: [],
        });
        const snapshot = await new SqliteSchemaIntrospector(connection).introspect();
        const counter = requireDefined(snapshot.schemas[0]?.tables.find(table =>
            table.tableName === 'counter'));

        expect(counter.columns[0]).toMatchObject({
            isStoreGenerated: true,
            storeGeneration: { kind: 'rowid', preventReuse: true },
        });
        const files = generateDbPullCode(snapshot, {
            contextName: 'PulledSqliteContext',
            providerName: 'sqlite',
            connectionStringExpression: JSON.stringify(':memory:'),
        });
        expect(files.map(file => file.contents).join('\n'))
            .toContain('.useSqliteRowId({ preventReuse: true })');

        const generated = loadGeneratedDbContext(
            files,
            'PulledSqliteContext',
            { 'entitykit/sqlite': sqliteProvider },
        );
        const pulled = await generated.create();
        try {
            expect(pulled.database.createScript())
                .toContain('"id" integer primary key autoincrement');
        } finally {
            await pulled.dispose();
        }
    });

    it('does not infer rowid semantics from quoted text, PRIMARY KEY DESC, or WITHOUT ROWID tables', async () => {
        await connection.query({
            text: 'create table "reusable" ("id" integer primary key check (\'autoincrement\' <> \'\'), "label" text)',
            values: [],
        });
        await connection.query({
            text: 'create table "explicit_key" ("id" integer primary key, "label" text) without rowid',
            values: [],
        });
        await connection.query({
            text: 'create table "descending_key" ("id" integer primary key desc, "label" text)',
            values: [],
        });
        const snapshot = await new SqliteSchemaIntrospector(connection).introspect();
        const tables = snapshot.schemas[0]?.tables ?? [];
        const reusable = requireDefined(tables.find(table =>
            table.tableName === 'reusable'));
        const explicit = requireDefined(tables.find(table =>
            table.tableName === 'explicit_key'));
        const descending = requireDefined(tables.find(table =>
            table.tableName === 'descending_key'));

        expect(reusable.columns[0]?.storeGeneration).toEqual({
            kind: 'rowid',
            preventReuse: false,
        });
        expect(explicit.columns[0]?.storeGeneration).toBeUndefined();
        expect(descending.columns[0]?.storeGeneration).toBeUndefined();
    });
});
