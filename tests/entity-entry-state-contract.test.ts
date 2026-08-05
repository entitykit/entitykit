import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, EntityState } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';

class StateItem {
    public id = '';
    public name = '';
}

class StateContext extends DbContext {
    public items = this.set(StateItem);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(StateItem, entity => {
            entity.toTable('state_items');
            entity.hasKey(item => item.id);
            entity.property(item => item.id).hasColumnType('text').isRequired();
            entity.property(item => item.name).hasColumnType('text').isRequired();
        });
    }
}

async function open(): Promise<StateContext> {
    const db = StateContext.create();
    await db.database.connection.query({
        text: db.database.createScript(),
        values: [],
    });
    await db.database.connection.query({
        text: 'insert into state_items (id, name) values (?, ?)',
        values: ['victim', 'persisted'],
    });
    return db;
}

function assignState(
    entry: { readonly state: EntityState },
    state: EntityState,
): void {
    (entry as { state: EntityState }).state = state;
}

describe('public EntityEntry state contract', () => {
    it('cannot turn an uninserted object into a delete for an existing row', async () => {
        const db = await open();
        const replacement = Object.assign(new StateItem(), {
            id: 'victim',
            name: 'never inserted',
        });
        const entry = db.items.add(replacement);

        expect(() => {
            assignState(entry, EntityState.Deleted);
        }).toThrow(TypeError);
        expect(entry.state).toBe(EntityState.Added);
        db.items.remove(replacement);
        await expect(db.saveChanges()).resolves.toBe(0);

        const result = await db.database.connection.query<{
            id: string;
            name: string;
        }>({
            text: 'select id, name from state_items',
            values: [],
        });
        expect(result.rows).toEqual([{ id: 'victim', name: 'persisted' }]);
        await db.dispose();
    });

    it('cannot claim a tracked entity is detached without tracker cleanup', async () => {
        const db = await open();
        const item = await db.items.find('victim');
        expect(item).not.toBeNull();
        if (!item) {
            throw new Error('Expected the persisted item to load.');
        }
        const entry = db.entry(item);
        expect(entry).toBeDefined();
        if (!entry) {
            throw new Error('Expected the loaded item to remain tracked.');
        }

        expect(() => {
            assignState(entry, EntityState.Detached);
        }).toThrow(TypeError);

        expect(entry.state).toBe(EntityState.Unchanged);
        expect(db.changeTracker.entries()).toEqual([entry]);
        await expect(db.items.find('victim')).resolves.toBe(item);
        await db.dispose();
    });
});
