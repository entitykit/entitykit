import { DbContext, EntityState, type DbContextOptionsBuilder, type ModelBuilder } from '../packages/core/src';
import { RecordingDatabaseConnection } from '../packages/testing/src';
import { CreationChild, CreationContext, CreationUser } from './support/creation-context';

describe('DbSet.create', () => {
    beforeEach(() => {
        CreationUser.constructions = 0;
    });

    it('constructs once with private state and defaults, then stages exactly one insert', async () => {
        const connection = new RecordingDatabaseConnection();
        await using db = CreationContext.create({ connection });
        const input = { id: 'ada', name: ' Ada ' };
        const user = db.users.create(input);

        expect(user).toBeInstanceOf(CreationUser);
        expect(user.identity()).toBe('ada');
        expect(user.name).toBe('Ada');
        expect(user.status).toBe('new');
        expect(input.name).toBe(' Ada ');
        expect(CreationUser.constructions).toBe(1);
        expect(db.entry(user)?.entity).toBe(user);
        expect(db.entry(user)?.state).toBe(EntityState.Added);
        expect(connection.operations).toEqual([]);
        user.name = 'Ada Lovelace';
        connection.queueResult({ rowCount: 1 });

        await expect(db.saveChanges()).resolves.toBe(1);
        expect(connection.statements).toHaveLength(1);
        expect(connection.statements[0]?.text).toMatch(/^insert into/iu);
        expect(connection.statements[0]?.values).toContain('Ada Lovelace');
        expect(db.entry(user)?.state).toBe(EntityState.Unchanged);
        await expect(db.saveChanges()).resolves.toBe(0);
        expect(connection.statements).toHaveLength(1);
    });

    it('supports constructor argument tuples and does not implicitly insert nested entities', async () => {
        await using db = CreationContext.create();
        const child = new CreationChild('child', 'parent');
        const user = db.users.create({ id: 'parent', name: 'Parent', children: [child] });
        expect(user.children).toEqual([child]);
        expect(db.entry(child)).toBeUndefined();
        expect(db.changeTracker.entries()).toHaveLength(1);
        const other = db.children.create('other', 'parent');
        expect(other).toBeInstanceOf(CreationChild);
        expect(other.userId).toBe('parent');
        expect(db.entry(other)?.state).toBe(EntityState.Added);
    });

    it('keeps explicit factories local to their set and shares context tracking', async () => {
        await using db = CreationContext.create();
        const factory = jest.fn((id: number) => new CreationUser({ id: String(id), name: 'Factory' }));
        const custom = db.set(CreationUser, { create: factory });
        const different = db.set(CreationUser, {
            create: (name: string) => new CreationUser({ id: name, name }),
        });
        const created = custom.create(1);
        expect(factory).toHaveBeenCalledTimes(1);
        expect(factory.mock.results[0]?.value).toBe(created);
        expect(db.set(CreationUser)).toBe(db.users);
        const ordinary = db.users.create({ id: 'ordinary', name: 'Ordinary' });
        const second = different.create('Second');
        expect(db.entry(created)?.entity).toBe(created);
        expect(db.entry(ordinary)?.entity).toBe(ordinary);
        expect(db.entry(second)?.entity).toBe(second);
        expect(db.changeTracker.entries()).toHaveLength(3);
        expect(factory).toHaveBeenCalledTimes(1);
    });

    it('keeps factory-first registration from replacing default constructor behavior', async () => {
        class Row {
            constructor(public id: string, public name: string) {}
        }
        class FactoryFirstContext extends DbContext {
            protected override configure(options: DbContextOptionsBuilder): void {
                options.useConnection(new RecordingDatabaseConnection());
            }
            protected override model(model: ModelBuilder): void {
                model.entity(Row, entity => {
                    entity.toTable('factory_first');
                    entity.hasKey(row => row.id);
                    entity.property(row => row.id).hasColumnType('text');
                    entity.property(row => row.name).hasColumnType('text');
                });
            }
        }
        await using db = FactoryFirstContext.create();
        const bound = db.set(Row, { create: (id: number) => new Row(String(id), 'Bound') });
        expect(bound.create(1).name).toBe('Bound');
        const ordinary = db.set(Row);
        expect(ordinary.create('default', 'Default').name).toBe('Default');
        expect(db.set(Row)).toBe(ordinary);
    });

    it('cancels a created entity through the existing remove path', async () => {
        const connection = new RecordingDatabaseConnection();
        await using db = CreationContext.create({ connection });
        const user = db.users.create({ id: 'canceled', name: 'Canceled' });
        expect(db.users.remove(user).state).toBe(EntityState.Detached);
        expect(db.entry(user)).toBeUndefined();
        await expect(db.saveChanges()).resolves.toBe(0);
        expect(connection.operations).toEqual([]);
    });
});
