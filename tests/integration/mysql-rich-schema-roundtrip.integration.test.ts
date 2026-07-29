import { requireDefined } from '../support/require-defined';
import { generateDbPullCodeWithDiagnostics, type DatabaseTable } from '../../src/tooling';
import {
    MySqlDatabaseConnection,
    MySqlSchemaIntrospector,
} from '../../src/providers/mysql';
import * as mysqlProvider from '../../src/providers/mysql';
import { loadGeneratedDbContext } from '../support/load-generated-db-context';
import {
    richSchemaShape,
    schemaObjects,
} from './rich-schema-roundtrip-support';

const url = process.env.MYSQL_URL ?? process.env.MYSQL_DATABASE_URL;
const shouldRun = process.env.RUN_MYSQL_TESTS === 'true' && Boolean(url);
const maybe = shouldRun ? describe : describe.skip;
const tableName = 'ek_rich_roundtrip_invoice';

maybe('MySQL rich-schema round trip', () => {
    let connection: MySqlDatabaseConnection;

    beforeEach(async () => {
        connection = new MySqlDatabaseConnection(requireDefined(url));
        await dropTable(connection);
        await connection.query({ text: initialSchemaSql(), values: [] });
    });

    afterEach(async () => {
        try {
            await dropTable(connection);
        } finally {
            await connection.dispose();
        }
    });

    it('recreates every rich facet MySQL can represent losslessly', async () => {
        const introspector = new MySqlSchemaIntrospector(connection);
        const original = schemaObjects(await introspector.introspect(), [tableName]);
        assertMySqlFeatures(requireInvoice(original.schemas[0]?.tables));

        const contextName = 'MySqlRichRoundTripContext';
        const pulledCode = generateDbPullCodeWithDiagnostics(original, {
            contextName,
            providerName: 'mysql',
            connectionStringExpression: JSON.stringify(url),
        });
        expect(pulledCode.diagnostics).toEqual([]);
        const generatedSource = pulledCode.files
            .map(file => file.contents)
            .join('\n');
        expect(generatedSource).toContain('.useAutoIncrement()');
        expect(generatedSource).toContain('.hasExpressionIndex(');

        const generated = loadGeneratedDbContext(
            pulledCode.files,
            contextName,
            { 'entitykit/mysql': mysqlProvider },
        );
        const context = await generated.create();
        try {
            await dropTable(connection);
            await context.database.connection.query({
                text: context.database.createScript(),
                values: [],
            });
            const recreated = schemaObjects(
                await introspector.introspect(),
                [tableName],
            );
            expect(richSchemaShape(recreated)).toEqual(richSchemaShape(original));

            await connection.query({
                text: `insert into \`${tableName}\` (\`email\`, \`subtotal\`) values (?, ?)`,
                values: ['ART@EXAMPLE.COM', 12],
            });
            const inserted = await connection.query<{
                id: number;
                normalized_email: string;
                status: string;
            }>({
                text: `select \`id\`, \`normalized_email\`, \`status\` from \`${tableName}\``,
                values: [],
            });
            expect(inserted.rows[0]).toEqual({
                id: 1,
                normalized_email: 'art@example.com',
                status: 'open',
            });
        } finally {
            await context.dispose();
        }
    });
});

function assertMySqlFeatures(table: DatabaseTable): void {
    expect(table.columns.find(column => column.name === 'id')?.storeGeneration)
        .toEqual({ kind: 'autoIncrement' });
    expect(table.columns.find(column => column.name === 'email')?.collation)
        .toBe('utf8mb4_bin');
    expect(table.columns.find(column => column.name === 'normalized_email'))
        .toMatchObject({
            generatedExpression: 'lower(`email`)',
            generatedStored: true,
        });
    expect(table.checkConstraints).toEqual([
        expect.objectContaining({ name: 'ck_rich_invoice_subtotal' }),
    ]);
    expect(table.indexes).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'ux_rich_invoice_email', isUnique: true }),
        expect.objectContaining({ name: 'ix_rich_invoice_lower_email' }),
    ]));
}

function requireInvoice(tables: readonly DatabaseTable[] | undefined): DatabaseTable {
    return requireDefined(tables?.find(table => table.tableName === tableName));
}

async function dropTable(connection: MySqlDatabaseConnection): Promise<void> {
    await connection.query({
        text: `drop table if exists \`${tableName}\``,
        values: [],
    });
}

function initialSchemaSql(): string {
    return `create table \`${tableName}\` (
  \`id\` int not null auto_increment,
  \`email\` varchar(255) collate utf8mb4_bin not null,
  \`normalized_email\` varchar(255)
    generated always as (lower(\`email\`)) stored,
  \`subtotal\` int not null default 0,
  \`status\` varchar(20) collate utf8mb4_bin not null default 'open',
  constraint \`pk_rich_invoice\` primary key (\`id\`),
  constraint \`ck_rich_invoice_subtotal\` check (\`subtotal\` >= 0),
  unique key \`ux_rich_invoice_email\` (\`email\`),
  key \`ix_rich_invoice_lower_email\` ((lower(\`email\`)))
)`;
}
