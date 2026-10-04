import { generateDbPullCode } from '../packages/core/src/tooling';
import * as sqliteProvider from '../packages/sqlite/src';
import { SqliteDatabaseConnection, SqliteSchemaIntrospector } from '../packages/sqlite/src';
import { loadGeneratedDbContext } from './support/load-generated-db-context';
import { requireDefined } from './support/require-defined';

describe('SQLite expression-scoped collations', () => {
    it.each([
        ['check', 'title text check (title collate nocase <> \'retired\')', undefined, true],
        ['default', 'title text default (\'Book\' collate nocase)', undefined, false],
        ['generated', 'title text generated always as (\'Book\' collate nocase) stored', undefined, false],
        ['column', 'title text collate binary check (title collate nocase <> \'retired\')', 'binary', true],
    ])('preserves comparison behavior after pulling a %s expression', async (_kind, definition, collation, supplyTitle) => {
        const original = new SqliteDatabaseConnection(':memory:');
        try {
            await original.query({ text: `create table books (id integer primary key, ${definition})`, values: [] });
            const snapshot = await new SqliteSchemaIntrospector(original).introspect();
            const table = requireDefined(snapshot.schemas[0].tables[0]);
            expect(table.columns.find(column => column.name === 'title')?.collation).toBe(collation);

            const files = generateDbPullCode(snapshot, {
                contextName: 'PulledBooksContext',
                providerName: 'sqlite',
                connectionStringExpression: JSON.stringify(':memory:'),
            });
            const generated = loadGeneratedDbContext(files, 'PulledBooksContext', { '@entitykit/sqlite': sqliteProvider });
            const pulled = await generated.create();
            try {
                await pulled.database.connection.query({ text: pulled.database.createScript(), values: [] });
                const rebuilt = await new SqliteSchemaIntrospector(pulled.database.connection).introspect();
                expect(rebuilt.schemas[0].tables[0].columns).toEqual(table.columns);
                expect(rebuilt.schemas[0].tables[0].checkConstraints).toEqual(table.checkConstraints);

                const insert = supplyTitle
                    ? { text: 'insert into books (id, title) values (?, ?)', values: [1, 'Book'] }
                    : { text: 'insert into books (id) values (?)', values: [1] };
                for (const database of [original, pulled.database.connection]) {
                    await database.query(insert);
                    const rows = (await database.query({ text: 'select title from books where title = ?', values: ['book'] })).rows;
                    expect(rows).toEqual([]);
                    expect((await database.query({ text: 'select title from books', values: [] })).rows).toEqual([{ title: 'Book' }]);
                }
            } finally {
                await pulled.dispose();
            }
        } finally {
            await original.dispose();
        }
    });

    it.each([
        ['(1 + 2)', 3],
        ['((1 + 2) * 3)', 9],
        ['(length(\'a,b)\'))', 4],
        ['(abs(-7))', 7],
        ['(case when 1 then 9 else 0 end)', 9],
        ['(0 /* ) , */ + 4)', 4],
    ])('recreates a parenthesized default %s without changing its result', async (expression, value) => {
        const original = new SqliteDatabaseConnection(':memory:');
        try {
            await original.query({ text: `create table amounts (id integer primary key, amount integer default ${expression})`, values: [] });
            const snapshot = await new SqliteSchemaIntrospector(original).introspect();
            const files = generateDbPullCode(snapshot, {
                contextName: 'PulledAmountsContext',
                providerName: 'sqlite',
                connectionStringExpression: JSON.stringify(':memory:'),
            });
            const generated = loadGeneratedDbContext(files, 'PulledAmountsContext', { '@entitykit/sqlite': sqliteProvider });
            const pulled = await generated.create();
            try {
                await pulled.database.connection.query({ text: pulled.database.createScript(), values: [] });
                const rebuilt = await new SqliteSchemaIntrospector(pulled.database.connection).introspect();
                expect(rebuilt.schemas[0].tables[0].columns).toEqual(snapshot.schemas[0].tables[0].columns);
                for (const database of [original, pulled.database.connection]) {
                    await database.query({ text: 'insert into amounts (id) values (?)', values: [1] });
                    expect((await database.query({ text: 'select amount from amounts', values: [] })).rows).toEqual([{ amount: value }]);
                }
            } finally {
                await pulled.dispose();
            }
        } finally {
            await original.dispose();
        }
    });
});
