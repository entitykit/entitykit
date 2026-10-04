import { generateDbPullCodeWithDiagnostics } from '../../packages/core/src/tooling';
import { SqliteDatabaseConnection, SqliteSchemaIntrospector, sqliteProviderServices } from '../../packages/sqlite/src';
import { PostgresDatabaseConnection, PostgresSchemaIntrospector } from '../../packages/postgres/src';
import { MySqlDatabaseConnection, MySqlSchemaIntrospector, mySqlProviderServices } from '../../packages/mysql/src';
import { loadGeneratedDbContext } from './load-generated-db-context';
import { requireDefined } from './require-defined';
import { richSchemaShape } from '../integration/rich-schema-roundtrip-support';

type Provider = 'sqlite' | 'postgres' | 'mysql';
const table = 'ek_mixed_key_books';
const cases = ['Edition Label', 'Edition `"Label'].flatMap(label => [false, true].map(reverse => ({ label, reverse })));

function connectionFor(provider: Provider, url: string): SqliteDatabaseConnection | PostgresDatabaseConnection | MySqlDatabaseConnection {
    if (provider === 'sqlite') return new SqliteDatabaseConnection(url);
    if (provider === 'postgres') return new PostgresDatabaseConnection(url);
    return new MySqlDatabaseConnection(url);
}

export function defineMixedIndexProviderTests(provider: Provider, url: () => string): void {
    it.each(cases)('recreates mixed keys for $label, reverse=$reverse', async ({ label, reverse }) => {
        const target = url();
        const connection = connectionFor(provider, target);
        const introspector = provider === 'sqlite' ? new SqliteSchemaIntrospector(connection)
            : provider === 'postgres' ? new PostgresSchemaIntrospector(connection) : new MySqlSchemaIntrospector(connection);
        const quote = (name: string): string => provider === 'mysql'
            ? `\`${name.replace(/`/g, '``')}\`` : `"${name.replace(/"/g, '""')}"`;
        const query = async (text: string): Promise<void> => {
            await connection.query({ text, values: [] });
        };
        const expression = `lower(${quote('Book,Title')})`;
        const keys = [quote(label), provider === 'mysql' ? `(${expression})` : expression];
        if (reverse) keys.reverse();
        try {
            await query(`drop table if exists ${quote(table)}`);
            await query(`create table ${quote(table)} (id integer primary key, ${quote(label)} varchar(64), ${quote('Book,Title')} varchar(64))`);
            await query(`create unique index ix_mixed_key_books on ${quote(table)} (${keys.join(', ')})`);
            const original = await introspector.introspect();
            const filtered = {
                schemas: original.schemas.map(schema => ({ name: schema.name, tables: schema.tables.filter(item => item.tableName === table) }))
                    .filter(schema => schema.tables.length > 0),
            };
            const originalTable = requireDefined(filtered.schemas[0]?.tables[0]);
            expect(originalTable.indexes[0]?.keyParts?.map(part => part.kind))
                .toEqual(reverse ? ['expression', 'column'] : ['column', 'expression']);
            const contextName = 'PulledMixedBookshop';
            const generated = generateDbPullCodeWithDiagnostics(filtered, {
                contextName, providerName: provider, connectionStringExpression: JSON.stringify(target),
            });
            expect(generated.diagnostics).toEqual([]);
            const context = await loadGeneratedDbContext(generated.files, contextName, {
                '@entitykit/sqlite': { sqliteProviderServices }, '@entitykit/mysql': { mySqlProviderServices },
            }).create();
            try {
                const script = context.database.createScript();
                await query(`drop table ${quote(table)}`);
                await context.database.connection.query({ text: script, values: [] });
                const recreated = await introspector.introspect();
                const recreatedTable = requireDefined(recreated.schemas.flatMap(schema => schema.tables).find(item => item.tableName === table));
                expect(richSchemaShape({ schemas: [{ name: filtered.schemas[0]?.name ?? '', tables: [recreatedTable] }] }))
                    .toEqual(richSchemaShape(filtered));
                await query(`insert into ${quote(table)} values (1,'Paperback','A Good Book'), (2,'Hardcover','a good book')`);
                await expect(connection.query({ text: `insert into ${quote(table)} values (3,'Paperback','A GOOD BOOK')`, values: [] }))
                    .rejects.toHaveProperty('cause.message', expect.stringMatching(/unique|duplicate/i));
                expect((await connection.query({ text: `select id from ${quote(table)} order by id`, values: [] })).rows)
                    .toEqual([{ id: 1 }, { id: 2 }]);
                expect(context.database.connection.isInTransaction).toBe(false);
            } finally {
                await context.dispose();
            }
        } finally {
            try {
                await query(`drop table if exists ${quote(table)}`);
            } finally {
                await connection.dispose();
            }
        }
    });
}
