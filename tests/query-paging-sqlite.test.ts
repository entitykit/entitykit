import type {
    DbContextOptionsBuilder,
    ModelBuilder,
} from '../src';
import {
    DbContext,
} from '../src';

class Widget {
    public id!: number;
    public category!: string;
}

class Label {
    public id!: number;
    public widgetId!: number;
    public name!: string;
}

class PagingContext extends DbContext {
    public widgets = this.set(Widget);
    public labels = this.set(Label);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useSqlite(':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(Widget, entity => {
            entity.toTable('widgets');
            entity.hasKey(widget => widget.id);
            entity.property(widget => widget.id).hasColumnName('id').hasColumnType('integer').isRequired();
            entity.property(widget => widget.category).hasColumnName('category').hasColumnType('text').isRequired();
        });
        model.entity(Label, entity => {
            entity.toTable('labels');
            entity.hasKey(label => label.id);
            entity.property(label => label.id).hasColumnName('id').hasColumnType('integer').isRequired();
            entity.property(label => label.widgetId).hasColumnName('widget_id').hasColumnType('integer').isRequired();
            entity.property(label => label.name).hasColumnName('name').hasColumnType('text').isRequired();
        });
    }
}

async function createDb(): Promise<PagingContext> {
    const db =  PagingContext.create();
    await db.database.connection.query({
        text: 'create table widgets (id integer primary key, category text not null)',
        values: [],
    });
    await db.database.connection.query({
        text: 'create table labels (id integer primary key, widget_id integer not null, name text not null)',
        values: [],
    });
    await db.database.connection.query({
        text: 'insert into widgets (id, category) values (?, ?), (?, ?), (?, ?), (?, ?)',
        values: [1, 'a', 2, 'a', 3, 'b', 4, 'c'],
    });
    await db.database.connection.query({
        text: 'insert into labels (id, widget_id, name) values (?, ?, ?), (?, ?, ?), (?, ?, ?)',
        values: [1, 1, 'one', 2, 2, 'two', 3, 3, 'three'],
    });
    return db;
}

describe('SQLite compositional query paging', () => {
    let db: PagingContext;

    beforeEach(async () => {
        db = await createDb();
    });

    afterEach(async () => {
        await db.dispose();
    });

    it('applies first and single to the already-paged entity and projection sequence', async () => {
        await expect(db.widgets.orderBy(widget => widget.id).take(0).firstOrNull())
            .resolves.toBeNull();
        await expect(db.widgets.orderBy(widget => widget.id).take(1).single())
            .resolves.toMatchObject({ id: 1 });
        await expect(db.widgets
            .orderBy(widget => widget.id)
            .take(0)
            .select(widget => ({ id: widget.id }))
            .firstOrNull()).resolves.toBeNull();
        await expect(db.widgets
            .orderBy(widget => widget.id)
            .take(1)
            .select(widget => ({ id: widget.id }))
            .single()).resolves.toEqual({ id: 1 });
    });

    it('counts and tests existence after entity and projected paging', async () => {
        await expect(db.widgets.skip(1).take(2).count()).resolves.toBe(2);
        await expect(db.widgets.take(0).exists()).resolves.toBe(false);
        await expect(db.widgets.skip(4).exists()).resolves.toBe(false);
        await expect(db.widgets
            .skip(2)
            .take(1)
            .select(widget => ({ id: widget.id }))
            .count()).resolves.toBe(1);
        await expect(db.widgets
            .take(0)
            .select(widget => ({ id: widget.id }))
            .exists()).resolves.toBe(false);
    });

    it('applies paging before joined projection cardinality terminals', async () => {
        const joined = db.widgets
            .join('label', db.labels, ({ root, label }) => root.id.eq(label.widgetId))
            .orderBy(({ root }) => root.id);

        await expect(joined
            .take(0)
            .select(({ root }) => ({ id: root.id }))
            .firstOrNull()).resolves.toBeNull();
        await expect(joined
            .take(1)
            .select(({ root, label }) => ({ id: root.id, label: label.name }))
            .single()).resolves.toEqual({ id: 1, label: 'one' });
        await expect(joined
            .skip(1)
            .take(1)
            .select(({ root }) => ({ id: root.id }))
            .count()).resolves.toBe(1);
        await expect(joined
            .take(0)
            .select(({ root }) => ({ id: root.id }))
            .exists()).resolves.toBe(false);
    });

    it('caps grouped first and single without widening an existing take', async () => {
        const grouped = db.widgets
            .groupBy(widget => ({ category: widget.category }))
            .orderBy(group => group.key.category);

        await expect(grouped
            .take(0)
            .select(group => ({ category: group.key.category, count: group.count() }))
            .firstOrNull()).resolves.toBeNull();
        await expect(grouped
            .take(1)
            .select(group => ({ category: group.key.category, count: group.count() }))
            .single()).resolves.toEqual({ category: 'a', count: 2 });
    });
});
