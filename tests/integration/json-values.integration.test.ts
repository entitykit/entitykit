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
    public label!: string | null;
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
            entity.property(d => d.label).hasColumnName('label').hasColumnType('jsonb');
        });
    }
}

const cases: Array<[string, unknown, unknown]> = [
    ['object', { unit: 'c', sample: 1 }, { unit: 'c', sample: 2 }],
    ['toplevel-array', [1, { active: true }], [2, { active: false }]],
    ['number', 42, 43],
    ['string', 'bare string', 'other string'],
    ['boolean', true, false],
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
            for (const [kind, first, second] of cases) {
                db.docs.add(Object.assign(new Doc(), {
                    id: `${kind}-first`, data: first, label: null,
                }));
                db.docs.add(Object.assign(new Doc(), {
                    id: `${kind}-second`, data: second, label: null,
                }));
            }
            db.docs.add(Object.assign(new Doc(), {
                id: 'sql-null', data: null, label: null,
            }));
            await db.saveChanges();
            db.changeTracker.clear();
        });

        afterEach(async () => {
            await db.database.connection.query({ text: 'drop table if exists jv_docs', values: [] });
            await db.dispose();
        });

        for (const [kind, first, second] of cases) {
            it(`round-trips and queries ${kind} values through the cache`, async () => {
                expect((await db.docs.find(`${kind}-first`))?.data).toEqual(first);
                const firstMatch = await db.docs
                    .where(doc => doc.data.eq(first))
                    .single();
                const secondMatch = await db.docs
                    .where(doc => doc.data.eq(second))
                    .single();

                expect(firstMatch.id).toBe(`${kind}-first`);
                expect(secondMatch.id).toBe(`${kind}-second`);
            });
        }

        it('matches recursively reordered objects across query paths', async () => {
            const stored = {
                status: 'active',
                filters: [{ tenant: 'acme', region: 'us' }],
            };
            const reordered = {
                filters: [{ region: 'us', tenant: 'acme' }],
                status: 'active',
            };
            db.docs.add(Object.assign(new Doc(), {
                id: 'canonical-object', data: stored, label: null,
            }));
            await db.saveChanges();
            db.changeTracker.clear();

            await expect(db.docs.where(doc => doc.data.eq(stored)).single())
                .resolves.toEqual(expect.objectContaining({ id: 'canonical-object' }));
            await expect(db.docs.where(doc => doc.data.eq(reordered)).single())
                .resolves.toEqual(expect.objectContaining({ id: 'canonical-object' }));
            await expect(db.docs.where(doc => doc.data.in([reordered])).single())
                .resolves.toEqual(expect.objectContaining({ id: 'canonical-object' }));

            const joined = await db.docs
                .join('peer', db.docs, ({ root, peer }) => root.id.eq(peer.id))
                .where(({ peer }) => peer.data.eq(reordered))
                .select(({ root }) => ({ id: root.id }))
                .single();
            expect(joined).toEqual({ id: 'canonical-object' });

            const updated = { version: 2, nested: { second: 2, first: 1 } };
            await expect(db.docs.where(doc => doc.data.eq(reordered))
                .executeUpdate({ data: updated })).resolves.toBe(1);
            await expect(db.docs.where(doc => doc.data.eq({
                nested: { first: 1, second: 2 }, version: 2,
            })).single()).resolves.toEqual(
                expect.objectContaining({ id: 'canonical-object' }),
            );
            await expect(db.docs.where(doc => doc.data.eq({
                nested: { first: 1, second: 2 }, version: 2,
            })).executeDelete()).resolves.toBe(1);
        });

        it('queries SQL null and JSON membership consistently', async () => {
            await expect(db.docs.where(doc => doc.data.eq(null)).single())
                .resolves.toEqual(expect.objectContaining({ id: 'sql-null' }));
            const matches = await db.docs
                .where(doc => doc.data.in([cases[0][1], cases[1][1], null]))
                .toArray();
            expect(matches.map(doc => doc.id).sort()).toEqual([
                'object-first', 'sql-null', 'toplevel-array-first',
            ]);
        });

        it('normalizes joined JSON predicates', async () => {
            const matches = await db.docs
                .join('peer', db.docs, ({ root, peer }) => root.id.eq(peer.id))
                .where(({ peer }) => peer.data.eq('bare string'))
                .select(({ root }) => ({ id: root.id }))
                .toArray();
            expect(matches).toEqual([{ id: 'string-first' }]);
        });

        it('normalizes set-based mutation predicates and assignments', async () => {
            await expect(db.docs
                .where(doc => doc.data.eq('bare string'))
                .executeUpdate({ data: 'updated string' }))
                .resolves.toBe(1);
            await expect(db.docs
                .where(doc => doc.data.eq(false))
                .executeDelete())
                .resolves.toBe(1);
            db.changeTracker.clear();
            await expect(db.docs.where(doc => doc.data.eq('updated string')).single())
                .resolves.toEqual(expect.objectContaining({ id: 'string-first' }));
            await expect(db.docs.where(doc => doc.data.eq(false)).toArray())
                .resolves.toEqual([]);
        });

        it('normalizes a JSON scalar coalesce fallback', async () => {
            const projected = await db.docs
                .where(doc => doc.id.eq('string-first'))
                .select((doc, sql) => ({
                    label: sql.coalesce(doc.label, sql.literal('fallback')),
                }))
                .single();
            expect(projected.label).toBe('fallback');
        });
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
