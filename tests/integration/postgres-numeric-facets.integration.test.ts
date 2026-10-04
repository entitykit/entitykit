import type { DbContext } from '../../packages/core/src';
import { generateDbPullCodeWithDiagnostics, type DatabaseSchemaSnapshot } from '../../packages/core/src/tooling';
import { PostgresDatabaseConnection, PostgresSchemaIntrospector } from '../../packages/postgres/src';
import { loadGeneratedDbContext } from '../support/load-generated-db-context';
import { requireDefined } from '../support/require-defined';
import { richSchemaShape } from './rich-schema-roundtrip-support';

const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
const maybe = process.env.RUN_POSTGRES_TESTS === 'true' && Boolean(url) ? describe : describe.skip;
const schema = 'ek_numeric_bookshop';
const expectedTypes = ['integer', 'numeric(10,0)', 'numeric(2,-3)', 'numeric(3,5)', 'numeric', 'integer'];

async function withPulledPrices(work: (context: DbContext, connection: PostgresDatabaseConnection) => Promise<void>): Promise<void> {
    const connection = new PostgresDatabaseConnection(requireDefined(url));
    let context: DbContext | undefined;
    const query = async (text: string): Promise<void> => {
        await connection.query({ text, values: [] });
    };
    try {
        await query(`drop schema if exists "${schema}" cascade`);
        await query(`create schema "${schema}"; create table "${schema}"."book_prices" (
            id integer primary key, unit_price numeric(10,0), bulk_price numeric(2,-3),
            fraction numeric(3,5), unconstrained numeric, copies integer
        )`);
        const original = await new PostgresSchemaIntrospector(connection).introspect({ schemas: [schema] });
        const contextName = 'PulledNumericBookshop';
        const generated = generateDbPullCodeWithDiagnostics(original, {
            contextName, providerName: 'postgres', connectionStringExpression: JSON.stringify(url),
        });
        context = await loadGeneratedDbContext(generated.files, contextName).create();
        const script = context.database.createScript();
        await query(`drop schema "${schema}" cascade`);
        await context.database.connection.query({ text: script, values: [] });
        await work(context, connection);
    } finally {
        try {
            await context?.dispose();
        } finally {
            try {
                await query(`drop schema if exists "${schema}" cascade`);
            } finally {
                await connection.dispose();
            }
        }
    }
}

function storeTypes(snapshot: DatabaseSchemaSnapshot): string[] {
    return requireDefined(snapshot.schemas[0]?.tables[0]).columns.map(column => column.storeType);
}

maybe('Postgres numeric Bookshop db-pull qualification', () => {
    it('recreates zero, signed and fractional scale declarations through generated code', async () => {
        await withPulledPrices(async (_context, connection) => {
            const snapshot = await new PostgresSchemaIntrospector(connection).introspect({ schemas: [schema] });
            expect(storeTypes(snapshot)).toEqual(expectedTypes);
            const catalog = await connection.query<{ column_name: string; numeric_precision: number | null; numeric_scale: number | null }>({
                text: 'select column_name, numeric_precision, numeric_scale from information_schema.columns where table_schema = $1 order by ordinal_position',
                values: [schema],
            });
            expect(catalog.rows).toEqual([
                { column_name: 'id', numeric_precision: 32, numeric_scale: 0 },
                { column_name: 'unit_price', numeric_precision: 10, numeric_scale: 0 },
                { column_name: 'bulk_price', numeric_precision: 2, numeric_scale: 2045 },
                { column_name: 'fraction', numeric_precision: 3, numeric_scale: 5 },
                { column_name: 'unconstrained', numeric_precision: null, numeric_scale: null },
                { column_name: 'copies', numeric_precision: 32, numeric_scale: 0 },
            ]);
        });
    });

    it('preserves native rounding and overflow constraints after schema recreation', async () => {
        await withPulledPrices(async (context, connection) => {
            await connection.query({ text: `insert into "${schema}"."book_prices" values (1,12.6,1250,0.001234,12.6,1)`, values: [] });
            const result = await connection.query({
                text: `select unit_price::text, bulk_price::text, fraction::text, unconstrained::text from "${schema}"."book_prices"`, values: [],
            });
            expect(result.rows).toEqual([{ unit_price: '13', bulk_price: '1000', fraction: '0.00123', unconstrained: '12.6' }]);
            for (const [column, value] of [['unit_price', '10000000000'], ['bulk_price', '100000'], ['fraction', '0.01']]) {
                await expect(connection.query({ text: `update "${schema}"."book_prices" set "${column}" = $1`, values: [value] }))
                    .rejects.toMatchObject({ code: '22003' });
            }
            expect(context.database.connection.isInTransaction).toBe(false);
            expect((await connection.query({ text: `select id from "${schema}"."book_prices"`, values: [] })).rows)
                .toEqual([{ id: 1 }]);
        });
    });
});

maybe('Postgres quoted Bookshop index qualification', () => {
    it('recreates quoted column keys, expressions, included columns and partial predicates', async () => {
        const connection = new PostgresDatabaseConnection(requireDefined(url));
        let context: DbContext | undefined;
        const query = async (text: string): Promise<void> => {
            await connection.query({ text, values: [] });
        };
        try {
            await query(`drop schema if exists "${schema}" cascade`);
            await query(`create schema "${schema}"; create table "${schema}"."books" (
                id text primary key, "Book,Title" text, "Book""Title" text, edition text, price integer
            );
            create unique index ix_quoted_books on "${schema}"."books" ("Book""Title", "Book,Title");
            create index ix_title_expression on "${schema}"."books" (lower("Book,Title")) include (edition) where price > 0`);
            const introspector = new PostgresSchemaIntrospector(connection);
            const original = await introspector.introspect({ schemas: [schema] });
            const indexes = requireDefined(original.schemas[0]?.tables[0]).indexes;
            expect(indexes).toEqual([
                expect.objectContaining({
                    name: 'ix_quoted_books', columns: ['Book"Title', 'Book,Title'], isUnique: true,
                    keyParts: [{ kind: 'column', name: 'Book"Title' }, { kind: 'column', name: 'Book,Title' }],
                    unsupportedFeatures: undefined,
                }),
                expect.objectContaining({
                    name: 'ix_title_expression', columns: [], includedColumns: ['edition'], filter: '(price > 0)',
                    keyParts: [{ kind: 'expression', expression: 'lower("Book,Title")' }], unsupportedFeatures: undefined,
                }),
            ]);
            const contextName = 'PulledIndexedBookshop';
            const generated = generateDbPullCodeWithDiagnostics(original, {
                contextName, providerName: 'postgres', connectionStringExpression: JSON.stringify(url),
            });
            expect(generated.diagnostics).toEqual([]);
            context = await loadGeneratedDbContext(generated.files, contextName).create();
            const script = context.database.createScript();
            await query(`drop schema "${schema}" cascade`);
            await context.database.connection.query({ text: script, values: [] });
            const recreated = await introspector.introspect({ schemas: [schema] });
            expect(richSchemaShape(recreated)).toEqual(richSchemaShape(original));
        } finally {
            try {
                await context?.dispose();
            } finally {
                try {
                    await query(`drop schema if exists "${schema}" cascade`);
                } finally {
                    await connection.dispose();
                }
            }
        }
    });
});
