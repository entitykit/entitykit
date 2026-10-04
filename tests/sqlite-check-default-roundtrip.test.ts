import { generateDbPullCode } from '../packages/core/src/tooling';
import * as sqliteProvider from '../packages/sqlite/src';
import { SqliteDatabaseConnection, SqliteSchemaIntrospector } from '../packages/sqlite/src';
import { loadGeneratedDbContext } from './support/load-generated-db-context';
import { requireDefined } from './support/require-defined';

describe('SQLite CHECK preservation after quoted defaults', () => {
    it.each([
        '\'constraint abc\'',
        '\'it\'\'s constraint abc\'',
        '\'constraint /* check(0) ) */ abc\'',
    ].flatMap(defaultSql => [
        { prefix: '', name: undefined },
        { prefix: 'constraint valid_value ', name: 'valid_value' },
        { prefix: 'constraint "valid value" ', name: 'valid value' },
        { prefix: 'constraint `valid value` ', name: 'valid value' },
        { prefix: 'constraint [valid value] ', name: 'valid value' },
    ].map(constraint => ({ defaultSql, ...constraint }))))(
        'preserves $defaultSql followed by $prefix CHECK', async ({ defaultSql, prefix, name }) => {
            const connection = new SqliteDatabaseConnection(':memory:');
            try {
                await connection.query({
                    text: `create table check_default (id integer primary key,
                    value text default ${defaultSql} ${prefix}check (length(value) > 0))`,
                    values: [],
                });
                await expect(connection.query({ text: 'insert into check_default (id, value) values (1, \'\')', values: [] }))
                    .rejects.toThrow(/CHECK constraint failed/u);
                await connection.query({ text: 'insert into check_default (id, value) values (1, \'valid\')', values: [] });

                const snapshot = await new SqliteSchemaIntrospector(connection).introspect();
                const table = requireDefined(snapshot.schemas[0]?.tables.find(candidate => candidate.tableName === 'check_default'));
                const checks = requireDefined(table.checkConstraints);
                expect(checks).toHaveLength(1);
                expect(checks[0]).toMatchObject({ sql: 'length(value) > 0' });
                if (name !== undefined) expect(checks[0]?.name).toBe(name);

                const files = generateDbPullCode(snapshot, {
                    contextName: 'PulledCheckContext',
                    providerName: 'sqlite',
                    connectionStringExpression: JSON.stringify(':memory:'),
                });
                const generated = loadGeneratedDbContext(files, 'PulledCheckContext', { '@entitykit/sqlite': sqliteProvider });
                const pulled = await generated.create();
                try {
                    await pulled.database.ensureCreated();
                    await expect(pulled.database.connection.query({ text: 'insert into check_default (id, value) values (1, \'\')', values: [] }))
                        .rejects.toThrow(/CHECK constraint failed/u);
                    await pulled.database.connection.query({ text: 'insert into check_default (id, value) values (1, \'valid\')', values: [] });
                    await pulled.database.connection.query({ text: 'insert into check_default (id) values (2)', values: [] });
                    const roundTrip = await new SqliteSchemaIntrospector(pulled.database.connection).introspect();
                    expect(roundTrip.schemas[0]?.tables[0]?.checkConstraints).toEqual(checks);
                } finally {
                    await pulled.dispose();
                }
            } finally {
                await connection.dispose();
            }
        },
    );
});
