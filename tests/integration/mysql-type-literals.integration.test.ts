import { DbContext, type DbContextOptionsBuilder, type ModelBuilder } from '../../packages/core/src';
import { generateDbPullCodeWithDiagnostics } from '../../packages/core/src/tooling';
import * as mysqlProvider from '../../packages/mysql/src';
import { MySqlSchemaIntrospector, mySqlProviderServices } from '../../packages/mysql/src';
import { loadGeneratedDbContext } from '../support/load-generated-db-context';
import { requireDefined } from '../support/require-defined';
import { schemaObjects } from './rich-schema-roundtrip-support';

const url = process.env.MYSQL_URL ?? process.env.MYSQL_DATABASE_URL;
const maybe = process.env.RUN_MYSQL_TESTS === 'true' && Boolean(url) ? describe : describe.skip;
const table = 'ek_book_format_literals';
const formatType = 'enum(\'Paperback\',\'Hardcover\',\'Collector\'\'s Edition\',\'Édition Française\')';
const marketType = 'set(\'NewYork\',\'SanFrancisco\')';

class BookFormat {
    public id!: number;
    public format!: string;
    public markets!: string;
}

class BookFormatContext extends DbContext {
    public readonly formats = this.set(BookFormat);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(mySqlProviderServices, requireDefined(url));
    }

    protected override model(model: ModelBuilder): void {
        model.entity(BookFormat, entity => {
            entity.toTable(table);
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
            entity.property(row => row.format).hasColumnType(formatType).useCollation('utf8mb4_bin').isRequired();
            entity.property(row => row.markets).hasColumnType(marketType).useCollation('utf8mb4_bin').isRequired();
        });
    }
}

maybe('MySQL Bookshop literal types', () => {
    let context: BookFormatContext;

    beforeEach(async () => {
        context = BookFormatContext.create();
        await context.database.connection.query({ text: `drop table if exists \`${table}\``, values: [] });
    });

    afterEach(async () => {
        try {
            await context.database.connection.query({ text: `drop table if exists \`${table}\``, values: [] });
        } finally {
            await context.dispose();
        }
    });

    it('round-trips case, escaped quotes, and Unicode through model DDL and ORM writes', async () => {
        await context.database.connection.query({ text: context.database.createScript(), values: [] });
        const values = ['Paperback', 'Hardcover', 'Collector\'s Edition', 'Édition Française'];
        for (const [id, format] of values.entries()) {
            context.formats.add(Object.assign(new BookFormat(), { id, format, markets: 'NewYork,SanFrancisco' }));
        }
        await context.saveChanges();
        context.changeTracker.clear();
        expect(await context.formats.orderBy(row => row.id).toArray()).toMatchObject(
            values.map((format, id) => ({ id, format, markets: 'NewYork,SanFrancisco' })),
        );
    });

    it('recreates a pulled schema and retains its literal values and defaults', async () => {
        await context.database.connection.query({
            text: `create table \`${table}\` (id int primary key, format ${formatType} collate utf8mb4_bin not null default 'Paperback', markets ${marketType} collate utf8mb4_bin not null default 'NewYork')`,
            values: [],
        });
        const introspector = new MySqlSchemaIntrospector(context.database.connection);
        const original = schemaObjects(await introspector.introspect(), [table]);
        expect(original.schemas[0]?.tables[0]?.columns.map(column => column.storeType))
            .toEqual(['int', formatType, marketType]);
        const pulled = generateDbPullCodeWithDiagnostics(original, {
            contextName: 'PulledBookFormatContext', providerName: 'mysql',
            connectionStringExpression: JSON.stringify(url),
        });
        const source = pulled.files.map(file => file.contents).join('\n');
        expect(source).toContain('"Paperback" | "Hardcover" | "Collector\'s Edition" | "Édition Française"');
        const generated = await loadGeneratedDbContext(pulled.files, 'PulledBookFormatContext', { '@entitykit/mysql': mysqlProvider }).create();
        try {
            await context.database.connection.query({ text: `drop table \`${table}\``, values: [] });
            await generated.database.connection.query({ text: generated.database.createScript(), values: [] });
            expect(schemaObjects(await introspector.introspect(), [table])).toEqual(original);
            await generated.database.connection.query({ text: `insert into \`${table}\` (id) values (1)`, values: [] });
            expect((await generated.database.connection.query({ text: `select id, format, markets from \`${table}\``, values: [] })).rows)
                .toEqual([{ id: 1, format: 'Paperback', markets: 'NewYork' }]);
        } finally {
            await generated.dispose();
        }
    });

    it('preserves existing and new labels when a migration extends an ENUM', async () => {
        const builder = mySqlProviderServices.createMigrationBuilder();
        builder.createTable(table, [
            { name: 'id', type: 'integer', primaryKey: true },
            { name: 'format', type: 'enum(\'Paperback\',\'Hardcover\')', nullable: false, collation: 'utf8mb4_bin' },
        ]);
        for (const statement of builder.statements) await context.database.connection.query(statement);
        await context.database.connection.query({ text: `insert into \`${table}\` (id, format) values (?, ?)`, values: [1, 'Paperback'] });
        const alteration = mySqlProviderServices.createMigrationBuilder();
        alteration.alterColumn(table, {
            name: 'format', type: formatType, oldType: 'enum(\'Paperback\',\'Hardcover\')',
            nullable: false, oldNullable: false, collation: 'utf8mb4_bin', oldCollation: 'utf8mb4_bin',
        });
        for (const statement of alteration.statements) await context.database.connection.query(statement);
        await context.database.connection.query({ text: `insert into \`${table}\` (id, format) values (?, ?)`, values: [2, 'Collector\'s Edition'] });
        expect((await context.database.connection.query({ text: `select id, format from \`${table}\` order by id`, values: [] })).rows)
            .toEqual([{ id: 1, format: 'Paperback' }, { id: 2, format: 'Collector\'s Edition' }]);
    });
});
