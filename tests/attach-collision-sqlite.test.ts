import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';

class AttachedItem {
    public id = '';
    public name = '';
}

class AttachContext extends DbContext {
    public items = this.set(AttachedItem);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(AttachedItem, entity => {
            entity.toTable('attached_items');
            entity.hasKey(item => item.id);
            entity.property(item => item.id).hasColumnType('text').isRequired();
            entity.property(item => item.name).hasColumnType('text').isRequired();
        });
    }
}

describe('public attach identity collision', () => {
    it('rejects the supplied duplicate instead of losing its later changes', async () => {
        const db = AttachContext.create();
        try {
            await db.database.connection.query({
                text: db.database.createScript(),
                values: [],
            });
            await db.database.connection.query({
                text: 'insert into attached_items (id, name) values (?, ?)',
                values: ['same', 'stored'],
            });
            const first = Object.assign(new AttachedItem(), {
                id: 'same',
                name: 'stored',
            });
            const supplied = Object.assign(new AttachedItem(), {
                id: 'same',
                name: 'supplied',
            });
            db.items.attach(first);

            expect(() => db.items.attach(supplied)).toThrow(
                'The supplied instance was not attached.',
            );
            expect(db.entry(supplied)).toBeUndefined();
            supplied.name = 'changed';

            await expect(db.saveChanges()).resolves.toBe(0);
            const stored = await db.database.connection.query<{ name: string }>({
                text: 'select name from attached_items where id = ?',
                values: ['same'],
            });
            expect(stored.rows).toEqual([{ name: 'stored' }]);
        } finally {
            await db.dispose();
        }
    });
});
