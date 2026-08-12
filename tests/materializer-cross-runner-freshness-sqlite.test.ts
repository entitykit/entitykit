import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';

class SharedFactoryRow {
    public id = '';
    public name = '';
    public parentId: string | null = null;
    public parent: SharedFactoryRow | null = null;
}

let singleton = new SharedFactoryRow();

class SharedFactoryContext extends DbContext {
    public rows = this.set(SharedFactoryRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(SharedFactoryRow, entity => {
            entity.toTable('shared_factory_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
            entity.property(row => row.parentId).hasColumnName('parent_id')
                .hasColumnType('text').isOptional();
            entity.hasOne(SharedFactoryRow, row => row.parent).withMany()
                .hasForeignKey(row => row.parentId);
            entity.materialize(() => singleton);
        });
    }
}

async function openContext(): Promise<SharedFactoryContext> {
    singleton = new SharedFactoryRow();
    const db = SharedFactoryContext.create();
    await db.database.connection.query({
        text: db.database.createScript(), values: [],
    });
    await db.database.connection.query({
        text: `insert into shared_factory_rows (id, name, parent_id)
            values (?, ?, ?), (?, ?, ?)`,
        values: ['one', 'first', null, 'two', 'second', 'one'],
    });
    return db;
}

async function firstStreamed(
    source: AsyncIterable<SharedFactoryRow>,
): Promise<SharedFactoryRow> {
    for await (const row of source) return row;
    throw new Error('Expected one streamed row.');
}

const freshnessError = 'A materializer must return a fresh instance.';

describe('materializer freshness across query runners', () => {
    it('rejects reuse from a buffered query into a stream', async () => {
        const db = await openContext();
        const first = await db.rows.asNoTracking()
            .where(row => row.id.eq('one')).single();

        await expect(firstStreamed(db.rows.asNoTracking()
            .where(row => row.id.eq('two')).stream()))
            .rejects.toThrow(freshnessError);

        expect(first).toMatchObject({ id: 'one', name: 'first' });
        await db.dispose();
    });

    it('rejects reuse from a stream into a buffered query', async () => {
        const db = await openContext();
        const first = await firstStreamed(db.rows.asNoTracking()
            .where(row => row.id.eq('one')).stream());

        await expect(db.rows.asNoTracking()
            .where(row => row.id.eq('two')).single())
            .rejects.toThrow(freshnessError);

        expect(first).toMatchObject({ id: 'one', name: 'first' });
        await db.dispose();
    });

    it('rejects reuse from a normal query into unsafe raw SQL', async () => {
        const db = await openContext();
        const first = await db.rows.where(row => row.id.eq('one')).single();

        await expect(db.rows.fromSqlUnsafe`
            select id, name, parent_id from shared_factory_rows
            where id = ${'two'}
        `.asNoTracking().toArray()).rejects.toThrow(freshnessError);

        expect(first).toMatchObject({ id: 'one', name: 'first' });
        await db.dispose();
    });

    it('rejects reuse between separate no-tracking queries', async () => {
        const db = await openContext();
        const first = await db.rows.asNoTracking()
            .where(row => row.id.eq('one')).single();

        await expect(db.rows.asNoTracking()
            .where(row => row.id.eq('two')).single())
            .rejects.toThrow(freshnessError);

        expect(first).toMatchObject({ id: 'one', name: 'first' });
        await db.dispose();
    });

    it('rejects reuse from a root query into its include loader', async () => {
        const db = await openContext();

        await expect(db.rows.asNoTracking()
            .include(row => row.parent)
            .where(row => row.id.eq('two')).single())
            .rejects.toThrow(freshnessError);

        await db.dispose();
    });
});
