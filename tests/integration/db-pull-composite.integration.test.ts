import { requireDefined } from '../support/require-defined';
import { generateDbPullCodeWithDiagnostics } from '../../src/tooling';
import { PostgresDatabaseConnection, PostgresSchemaIntrospector } from '../../src/providers/postgres';

const shouldRunPostgresTests = process.env.RUN_POSTGRES_TESTS === 'true' && Boolean(process.env.DATABASE_URL);
const describePostgres = shouldRunPostgresTests ? describe : describe.skip;

describePostgres('db pull against a live composite-keyed schema', () => {
    let connection: PostgresDatabaseConnection;

    beforeEach(async () => {
        connection = new PostgresDatabaseConnection(requireDefined(process.env.DATABASE_URL));
        await connection.query({ text: 'drop schema if exists "db_pull_composite" cascade', values: [] });
        await connection.query({ text: 'create schema "db_pull_composite"', values: [] });
        await connection.query({
            text: `
        create table "db_pull_composite"."order_lines" (
          "order_id" text not null,
          "line_number" integer not null,
          "sku" text not null,
          primary key ("order_id", "line_number")
        );

        create table "db_pull_composite"."allocations" (
          "id" text primary key,
          "order_id" text not null,
          "line_number" integer not null,
          constraint "fk_allocations_order_lines"
            foreign key ("order_id", "line_number")
            references "db_pull_composite"."order_lines" ("order_id", "line_number")
            on delete cascade
        );
      `,
            values: [],
        });
    });

    afterEach(async () => {
        await connection.query({ text: 'drop schema if exists "db_pull_composite" cascade', values: [] });
        await connection.dispose();
    });

    it('introspects the composite primary key and multi-column foreign key', async () => {
        const introspector = new PostgresSchemaIntrospector(connection);
        const snapshot = await introspector.introspect({ schemas: ['db_pull_composite'] });
        const tables = snapshot.schemas[0].tables;

        const orderLines = requireDefined(tables.find(table => table.tableName === 'order_lines'));
        expect(requireDefined(orderLines.primaryKey).columns).toEqual(['order_id', 'line_number']);

        const allocations = requireDefined(tables.find(table => table.tableName === 'allocations'));
        const foreignKey = allocations.foreignKeys[0];
        expect(foreignKey.columns).toEqual(['order_id', 'line_number']);
        expect(foreignKey.principalColumns).toEqual(['order_id', 'line_number']);
    });

    it('generates starter code that needs no review', async () => {
        const introspector = new PostgresSchemaIntrospector(connection);
        const snapshot = await introspector.introspect({ schemas: ['db_pull_composite'] });
        const result = generateDbPullCodeWithDiagnostics(snapshot, {
            contextName: 'PulledDbContext',
        });

        const contextFile = requireDefined(result.files.find(file => file.path === 'pulled-db-context.ts')).contents;
        expect(contextFile).toContain('entity.hasKey(row => [row.orderId, row.lineNumber]);');
        expect(contextFile).toContain('.hasForeignKey(row => [row.orderId, row.lineNumber])');
        expect(result.diagnostics).toEqual([]);
    });
});
