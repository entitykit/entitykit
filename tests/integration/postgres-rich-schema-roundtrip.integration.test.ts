import { requireDefined } from '../support/require-defined';
import { generateDbPullCodeWithDiagnostics, type DatabaseTable } from '../../src/tooling';
import {
    PostgresDatabaseConnection,
    PostgresSchemaIntrospector,
} from '../../src/providers/postgres';
import { loadGeneratedDbContext } from '../support/load-generated-db-context';
import { richSchemaShape } from './rich-schema-roundtrip-support';

const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
const shouldRun = process.env.RUN_POSTGRES_TESTS === 'true' && Boolean(url);
const maybe = shouldRun ? describe : describe.skip;
const schema = 'ek_rich_roundtrip';

maybe('Postgres rich-schema round trip', () => {
    let connection: PostgresDatabaseConnection;

    beforeEach(async () => {
        connection = new PostgresDatabaseConnection(requireDefined(url));
        await dropSchema(connection);
        await connection.query({ text: initialSchemaSql(), values: [] });
    });

    afterEach(async () => {
        try {
            await dropSchema(connection);
        } finally {
            await connection.dispose();
        }
    });

    it('recreates all lossless rich metadata through generated db-pull code', async () => {
        const introspector = new PostgresSchemaIntrospector(connection);
        const original = await introspector.introspect({ schemas: [schema] });
        assertPostgresFeatures(requireInvoice(original.schemas[0]?.tables));
        expect(original.schemas[0]?.sequences).toEqual([
            expect.objectContaining({
                name: 'invoice_numbers',
                dataType: 'integer',
                startValue: '100',
                incrementBy: '5',
                cache: 3,
            }),
        ]);

        const contextName = 'PostgresRichRoundTripContext';
        const pulledCode = generateDbPullCodeWithDiagnostics(original, {
            contextName,
            providerName: 'postgres',
            connectionStringExpression: JSON.stringify(url),
        });
        expect(pulledCode.diagnostics).toEqual([]);
        expect(pulledCode.files.map(file => file.contents).join('\n')).toEqual(
            expect.stringContaining('.useIdentityColumn('),
        );

        const generated = loadGeneratedDbContext(pulledCode.files, contextName);
        const context = await generated.create();
        try {
            await dropSchema(connection);
            await context.database.connection.query({
                text: context.database.createScript(),
                values: [],
            });
            const recreated = await introspector.introspect({ schemas: [schema] });
            expect(richSchemaShape(recreated)).toEqual(richSchemaShape(original));

            const inserted = await connection.query<{
                id: number;
                invoice_number: number;
                normalized_email: string;
            }>({
                text: `insert into "${schema}"."invoice" ("email", "subtotal")
values ($1, $2)
returning "id", "invoice_number", "normalized_email"`,
                values: ['ART@EXAMPLE.COM', 12],
            });
            expect(inserted.rows[0]).toEqual({
                id: 10,
                invoice_number: 100,
                normalized_email: 'art@example.com',
            });
        } finally {
            await context.dispose();
        }
    });
});

function assertPostgresFeatures(table: DatabaseTable): void {
    expect(table.columns.find(column => column.name === 'id')?.storeGeneration)
        .toMatchObject({ kind: 'identity', mode: 'byDefault', incrementBy: '2' });
    expect(table.columns.find(column => column.name === 'invoice_number')
        ?.storeGeneration).toEqual({
        kind: 'sequence',
        name: 'invoice_numbers',
        schemaName: schema,
    });
    expect(table.columns.find(column => column.name === 'email')?.collation)
        .toBe('C');
    expect(table.columns.find(column => column.name === 'normalized_email'))
        .toMatchObject({
            generatedExpression: 'lower(email)',
            generatedStored: true,
        });
    expect(table.checkConstraints).toEqual([
        expect.objectContaining({ name: 'ck_invoice_subtotal' }),
    ]);
    expect(table.indexes).toEqual([
        expect.objectContaining({
            name: 'ix_invoice_lower_email_open',
            includedColumns: ['status'],
            filter: '(subtotal > 0)',
        }),
    ]);
}

function requireInvoice(tables: readonly DatabaseTable[] | undefined): DatabaseTable {
    return requireDefined(tables?.find(table => table.tableName === 'invoice'));
}

async function dropSchema(connection: PostgresDatabaseConnection): Promise<void> {
    await connection.query({
        text: `drop schema if exists "${schema}" cascade`,
        values: [],
    });
}

function initialSchemaSql(): string {
    return `create schema "${schema}";
create sequence "${schema}"."invoice_numbers"
  as integer start with 100 increment by 5 minvalue 100 maxvalue 10000 cache 3;
create table "${schema}"."invoice" (
  "id" integer generated by default as identity
    (start with 10 increment by 2 minvalue 10 maxvalue 10000 cache 4),
  "invoice_number" integer not null
    default nextval('"${schema}"."invoice_numbers"'::regclass),
  "email" text collate "C" not null,
  "normalized_email" text generated always as (lower("email")) stored,
  "subtotal" integer not null default 0,
  "status" text not null default 'open'::text,
  constraint "pk_invoice" primary key ("id"),
  constraint "ck_invoice_subtotal" check ("subtotal" >= 0)
);
create index "ix_invoice_lower_email_open"
  on "${schema}"."invoice" ((lower("email")))
  include ("status") where "subtotal" > 0;`;
}
