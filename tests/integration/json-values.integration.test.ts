import type {
    DbContextOptionsBuilder,
    ModelBuilder,
} from '../../src';
import {
    DbContext,
} from '../../src';

/**
 * A `jsonb` column round-trips every JSON shape identically on every provider
 * — not just objects, but a top-level array or a bare primitive.
 *
 * Serialization used to be left to the driver, keyed on the JS value type: a
 * top-level array bound as a native array on Postgres (invalid JSON, a hard
 * insert failure) and a bare boolean bound as `0`/`1` on SQLite. The value is
 * now JSON-serialized by column type before binding.
 *
 * SQLite runs in-process (unconditional); Postgres and MySQL are gated.
 */
class Doc {
    public id!: string;
    public data!: unknown;
}

class DocContext extends DbContext {
    public static configureProvider: (options: DbContextOptionsBuilder) => void;

    public docs = this.set(Doc);

    protected override configure(options: DbContextOptionsBuilder): void {
        DocContext.configureProvider(options);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(Doc, entity => {
            entity.toTable('jv_docs');
            entity.hasKey(d => d.id);
            entity.property(d => d.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(d => d.data).hasColumnName('data').hasColumnType('jsonb'); // nullable
        });
    }
}

const cases: Array<[string, unknown]> = [
    ['object', { unit: 'c', samples: [1, 2, 3] }],
    ['toplevel-array', [1, 2, { a: 'b' }]],
    ['number', 42],
    ['string', 'bare string'],
    ['boolean', true],
    ['sql-null', null],
];

function defineTests(label: string, configure: (options: DbContextOptionsBuilder) => void): void {
    describe(`jsonb value round-trip (${label})`, () => {
        let db: DocContext;

        beforeEach(async () => {
            DocContext.configureProvider = configure;
            db =  DocContext.create();
            await db.database.connection.query({ text: 'drop table if exists jv_docs', values: [] });
            for (const statement of db.database.createScript().split(';').map(s => s.trim()).filter(Boolean)) {
                await db.database.connection.query({ text: statement, values: [] });
            }
            for (const [id, data] of cases) db.docs.add(Object.assign(new Doc(), { id, data }));
            await db.saveChanges();
            db.changeTracker.clear();
        });

        afterEach(async () => {
            await db.database.connection.query({ text: 'drop table if exists jv_docs', values: [] });
            await db.dispose();
        });

        for (const [id, original] of cases) {
            it(`round-trips a ${id} value`, async () => {
                const doc = await db.docs.find(id);
                expect(doc?.data).toEqual(original);
            });
        }
    });
}

defineTests('SQLite', options => options.useSqlite(':memory:'));

const postgresUrl = process.env.DATABASE_URL;
if (process.env.RUN_POSTGRES_TESTS === 'true' && postgresUrl) {
    defineTests('Postgres', options => options.usePostgres(postgresUrl));
}

const mysqlUrl = process.env.MYSQL_URL ?? process.env.MYSQL_DATABASE_URL;
if (process.env.RUN_MYSQL_TESTS === 'true' && mysqlUrl) {
    defineTests('MySQL', options => options.useMySql(mysqlUrl));
}
