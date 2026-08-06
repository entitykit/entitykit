import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, lazy } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';

class CompositeParent {
    public first = '';
    public second = '';
    public children: CompositeChild[] = [];
}

class CompositeChild {
    public id = '';
    public parentFirst = '';
    public parentSecond = '';
    public parent?: CompositeParent;
}

class CompositeLazyContext extends DbContext {
    public parents = this.set(CompositeParent);
    public children = this.set(CompositeChild);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:')
            .useLazyLoading({ maxPerContext: 2 });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(CompositeParent, entity => {
            entity.toTable('composite_parents');
            entity.hasKey(parent => [parent.first, parent.second]);
            entity.property(parent => parent.first).hasColumnType('text').isRequired();
            entity.property(parent => parent.second).hasColumnType('text').isRequired();
        });
        model.entity(CompositeChild, entity => {
            entity.toTable('composite_children');
            entity.hasKey(child => child.id);
            entity.property(child => child.id).hasColumnType('text').isRequired();
            entity.property(child => child.parentFirst)
                .hasColumnName('parent_first').hasColumnType('text').isRequired();
            entity.property(child => child.parentSecond)
                .hasColumnName('parent_second').hasColumnType('text').isRequired();
            entity.hasOne(CompositeParent, child => child.parent)
                .withMany(parent => parent.children)
                .hasForeignKey(child => [child.parentFirst, child.parentSecond]);
        });
    }
}

async function open(): Promise<CompositeLazyContext> {
    const db = CompositeLazyContext.create();
    await db.database.connection.query({
        text: db.database.createScript(),
        values: [],
    });
    await db.database.connection.query({
        text: `insert into composite_parents (first, second)
            values (?, ?), (?, ?)`,
        values: ['a,b', 'c', 'a', 'b,c'],
    });
    await db.database.connection.query({
        text: `insert into composite_children
            (id, parent_first, parent_second) values (?, ?, ?), (?, ?, ?)`,
        values: ['child-1', 'a,b', 'c', 'child-2', 'a', 'b,c'],
    });
    return db;
}

describe('composite lazy-load identity', () => {
    it('does not deduplicate composite keys with the same string form', async () => {
        const db = await open();
        const first = await db.parents.find('a,b', 'c');
        const second = await db.parents.find('a', 'b,c');
        if (!first || !second) throw new Error('Expected both parents.');

        const [firstChildren, secondChildren] = await Promise.all([
            lazy(first).children,
            lazy(second).children,
        ]);

        expect(firstChildren.map(child => child.id)).toEqual(['child-1']);
        expect(secondChildren.map(child => child.id)).toEqual(['child-2']);
        expect(first.children).toBe(firstChildren);
        expect(second.children).toBe(secondChildren);
        await db.dispose();
    });
});
