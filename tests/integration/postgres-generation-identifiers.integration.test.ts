import { generateDbPullCodeWithDiagnostics } from '../../packages/core/src/tooling';
import { PostgresDatabaseConnection, PostgresSchemaIntrospector } from '../../packages/postgres/src';
import { loadGeneratedDbContext } from '../support/load-generated-db-context';
import { requireDefined } from '../support/require-defined';

const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
const maybe = process.env.RUN_POSTGRES_TESTS === 'true' && Boolean(url) ? describe : describe.skip;
const schema = 'ek_generation_identifiers ';
const ownedName = ' padded.counter ';
const fallbackName = ' fallback.counter"quote ';
const quote = (name: string): string => `"${name.replace(/"/g, '""')}"`;
const table = `${quote(schema)}."items"`;
const owned = `${quote(schema)}.${quote(ownedName)}`;
const fallback = `${quote(schema)}.${quote(fallbackName)}`;

maybe('Postgres generation identifier round trip', () => {
    it('preserves owned and referenced sequence names through executable generated model code', async () => {
        const connection = new PostgresDatabaseConnection(requireDefined(url));
        const query = async (text: string): Promise<void> => {
            await connection.query({ text, values: [] });
        };
        const drop = async (): Promise<void> => {
            await query(`drop schema if exists ${quote(schema)} cascade`);
        };
        try {
            await drop();
            await query(`create schema ${quote(schema)}`);
            await query(`create sequence ${owned}`);
            await query(`create sequence ${fallback}`);
            await query(`create table ${table} (
                id integer primary key default nextval('${owned}'::regclass),
                alternate integer not null default nextval('${fallback}'::regclass),
                offsetted integer not null default (nextval('${fallback}'::regclass) + 100))`);
            await query(`alter sequence ${owned} owned by ${table}.id`);
            await query(`insert into ${table} default values`);
            const introspector = new PostgresSchemaIntrospector(connection);
            const original = await introspector.introspect({ schemas: [schema] });
            const columns = requireDefined(original.schemas[0]?.tables[0]?.columns);
            expect(columns.map(column => column.storeGeneration)).toEqual([
                { kind: 'sequence', name: ownedName, schemaName: schema },
                { kind: 'sequence', name: fallbackName, schemaName: schema },
                undefined,
            ]);
            expect((await connection.query({ text: `select id,alternate,offsetted from ${table}`, values: [] })).rows)
                .toEqual([{ id: 1, alternate: 1, offsetted: 102 }]);

            const contextName = 'GenerationIdentifierContext';
            const generated = generateDbPullCodeWithDiagnostics(original, {
                contextName, providerName: 'postgres', connectionStringExpression: JSON.stringify(url),
            });
            expect(generated.diagnostics).toEqual([]);
            const context = await loadGeneratedDbContext(generated.files, contextName).create();
            try {
                await drop();
                await query(context.database.createScript());
                const recreated = await introspector.introspect({ schemas: [schema] });
                expect(recreated.schemas[0]?.tables[0]?.columns.map(column => column.storeGeneration))
                    .toEqual(columns.map(column => column.storeGeneration));
                expect(requireDefined(recreated.schemas[0]?.sequences).map(sequence => sequence.name).sort())
                    .toEqual([ownedName, fallbackName].sort());
                expect((await connection.query({
                    text: `insert into ${table} default values returning id,alternate,offsetted`, values: [],
                })).rows).toEqual([{ id: 1, alternate: 1, offsetted: 102 }]);
            } finally {
                await context.dispose();
            }
        } finally {
            try {
                await drop();
            } finally {
                await connection.dispose();
            }
        }
    });
});
