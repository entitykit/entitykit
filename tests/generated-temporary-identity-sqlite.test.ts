import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext } from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';

class TemporaryParent {
    public id = 0;
    public name = '';
    public children: TemporaryChild[] = [];
}

class TemporaryChild {
    public id = '';
    public parentId = 0;
    public parent: TemporaryParent | null = null;
}

class TemporaryIdentityContext extends DbContext {
    public parents = this.set(TemporaryParent);
    public children = this.set(TemporaryChild);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(TemporaryParent, entity => {
            entity.toTable('temporary_parents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer')
                .isRequired().useSqliteRowId();
            entity.property(row => row.name).hasColumnType('text').isRequired();
        });
        model.entity(TemporaryChild, entity => {
            entity.toTable('temporary_children');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.parentId).hasColumnName('parent_id')
                .hasColumnType('integer').isRequired();
            entity.hasOne(TemporaryParent, row => row.parent)
                .withMany(row => row.children)
                .hasForeignKey(row => row.parentId);
        });
    }
}

async function open(): Promise<TemporaryIdentityContext> {
    const db = TemporaryIdentityContext.create();
    await db.database.connection.query({
        text: db.database.createScript(), values: [],
    });
    await db.database.connection.query({
        text: 'insert into temporary_parents (id, name) values (?, ?)',
        values: [0, 'existing-zero'],
    });
    return db;
}

describe('temporary relationship identity on SQLite', () => {
    it('does not redirect an FK-only child from durable row zero', async () => {
        const db = await open();
        const parent = Object.assign(new TemporaryParent(), {
            name: 'unrelated-new-parent',
        });
        const child = Object.assign(new TemporaryChild(), {
            id: 'fk-only-child', parentId: 0,
        });
        db.parents.add(parent);
        db.children.add(child);

        await expect(db.saveChanges()).rejects.toThrow(
            'cannot infer a newly added principal',
        );

        await expect(db.parents.count()).resolves.toBe(1);
        await expect(db.children.count()).resolves.toBe(0);
        expect(child.parent).toBeNull();
        expect(parent.children).toEqual([]);
        await db.dispose();
    });

    it.each(['remove', 'detach'] as const)(
        'keeps an explicit graph atomic when principal %s is rejected',
        async operation => {
            const db = await open();
            const parent = Object.assign(new TemporaryParent(), {
                name: 'new-parent',
            });
            const child = Object.assign(new TemporaryChild(), {
                id: `child-${operation}`, parent,
            });
            parent.children = [child];
            db.parents.add(parent);
            db.children.add(child);

            expect(() => db.parents[operation](parent)).toThrow(
                'Cannot detach or cancel newly added',
            );
            await expect(db.saveChanges()).resolves.toBe(2);

            expect(parent.id).toBe(1);
            expect(child.parentId).toBe(1);
            const stored = await db.database.connection.query<{
                parent_id: number;
            }>({
                text: `select parent_id from temporary_children
                    where id = ?`,
                values: [child.id],
            });
            expect(stored.rows).toEqual([{ parent_id: 1 }]);
            await db.dispose();
        },
    );
});
