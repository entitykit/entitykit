import { requireDefined } from '../support/require-defined';
import { generateDbPullCode, type DatabaseSchemaSnapshot } from '../../packages/core/src/tooling';
import { PostgresDatabaseConnection, PostgresSchemaIntrospector } from '../../packages/postgres/src';
import { loadGeneratedDbContext } from '../support/load-generated-db-context';

const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
const shouldRun = process.env.RUN_POSTGRES_TESTS === 'true' && Boolean(url);
const maybe = shouldRun ? describe : describe.skip;

/**
 * The db pull round-trip guarantee for Postgres, against a live server: the same
 * lossless proof the MySQL and SQLite round-trips make. Postgres keeps
 * its real `public` schema — `create schema if not exists "public"` is a valid
 * no-op — so this confirms the round-trip works where the generated model *does*
 * qualify, the case the SQLite fix deliberately does not touch.
 */
function columnShape(snapshot: DatabaseSchemaSnapshot, tableName: string): Array<{ name: string; storeType: string; isNullable: boolean; }> | undefined {
    const table = snapshot.schemas.flatMap(schema => schema.tables).find(candidate => candidate.tableName === tableName);
    return table?.columns.map(column => ({ name: column.name, storeType: column.storeType, isNullable: column.isNullable }));
}

maybe('Postgres db pull round-trip', () => {
    let connection: PostgresDatabaseConnection;

    const dropAll = async (): Promise<void> => {
        await connection.query({ text: 'drop table if exists ek_rt_post cascade', values: [] });
        await connection.query({ text: 'drop table if exists ek_rt_author cascade', values: [] });
    };

    beforeEach(async () => {
        connection = new PostgresDatabaseConnection(requireDefined(url));
        await dropAll();
        await connection.query({ text: 'create table ek_rt_author ("id" text primary key, "name" text not null)', values: [] });
        await connection.query({
            text: 'create table ek_rt_post ("id" text primary key, "title" text, "views" integer not null, "published" boolean not null, "meta" jsonb, "author_id" text references ek_rt_author ("id") on delete cascade)',
            values: [],
        });
        await connection.query({ text: 'create index ix_ek_rt_post_views on ek_rt_post ("views")', values: [] });
    });

    afterEach(async () => {
        await dropAll();
        await connection.dispose();
    });

    it('regenerates a schema whose generated model recreates it losslessly', async () => {
        const snapshot = await new PostgresSchemaIntrospector(connection).introspect();

        const contextName = 'PulledPgContext';
        const files = generateDbPullCode(snapshot, { contextName, providerName: 'postgres', connectionStringExpression: JSON.stringify(url) });
        const contextFile = requireDefined(files.find(file =>
            file.path === 'pulled-pg-context.ts',
        )).contents;
        expect(contextFile).toContain('options.usePostgres(');
        // Postgres keeps its real schema — the public qualifier is valid and its
        // create-schema is a harmless no-op, unlike SQLite's implicit main.
        expect(contextFile).toContain('entity.toTable("ek_rt_post", "public");');

        const generated = loadGeneratedDbContext(files, contextName);
        const pulled = await generated.create();
        try {
            const script = pulled.database.createScript();
            await connection.query({ text: 'drop table if exists ek_rt_post cascade', values: [] });
            await connection.query({ text: 'drop table if exists ek_rt_author cascade', values: [] });
            await pulled.database.connection.query({ text: script, values: [] });

            const roundTrip = await new PostgresSchemaIntrospector(connection).introspect();
            expect(columnShape(roundTrip, 'ek_rt_author')).toEqual(columnShape(snapshot, 'ek_rt_author'));
            expect(columnShape(roundTrip, 'ek_rt_post')).toEqual(columnShape(snapshot, 'ek_rt_post'));
            const post = requireDefined(roundTrip.schemas.flatMap(schema => schema.tables).find(table => table.tableName === 'ek_rt_post'));
            expect(post.foreignKeys.map(fk => fk.principalTableName)).toEqual(['ek_rt_author']);
            expect(post.indexes.map(index => index.columns)).toContainEqual(['views']);
        } finally {
            await pulled.dispose();
        }
    });
});
