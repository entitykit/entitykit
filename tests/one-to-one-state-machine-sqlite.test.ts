import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, DeleteBehavior, EntityState } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';

class SlotParent {
    public id = '';
    public profile: SlotProfile | null = null;
}

class SlotProfile {
    public id = '';
    public parentId: string | null = null;
    public parent: SlotParent | null = null;
}

class SlotContext extends DbContext {
    public parents = this.set(SlotParent);
    public profiles = this.set(SlotProfile);

    constructor(
        private readonly behavior: DeleteBehavior,
        private readonly optional: boolean,
    ) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(SlotParent, entity => {
            entity.toTable('slot_parents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
        });
        model.entity(SlotProfile, entity => {
            entity.toTable('slot_profiles');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            const foreignKey = entity.property(row => row.parentId)
                .hasColumnName('parent_id').hasColumnType('text');
            if (this.optional) foreignKey.isOptional();
            else foreignKey.isRequired();
            entity.hasOne(SlotParent, row => row.parent)
                .withOne(row => row.profile)
                .hasForeignKey(row => row.parentId)
                .onDelete(this.behavior);
        });
    }
}

interface SlotGraph {
    readonly db: SlotContext;
    readonly firstParent: SlotParent;
    readonly secondParent: SlotParent;
    readonly first: SlotProfile;
    readonly second: SlotProfile;
}

async function graph(
    behavior: DeleteBehavior,
    optional: boolean,
    order: 'first-first' | 'second-first' = 'first-first',
): Promise<SlotGraph> {
    const db = SlotContext.create(behavior, optional);
    await db.database.connection.query({
        text: db.database.createScript(), values: [],
    });
    await db.database.connection.query({
        text: 'insert into slot_parents (id) values (?), (?)',
        values: ['p1', 'p2'],
    });
    await db.database.connection.query({
        text: 'insert into slot_profiles (id, parent_id) values (?, ?), (?, ?)',
        values: ['d1', 'p1', 'd2', 'p2'],
    });
    const firstParent = Object.assign(new SlotParent(), { id: 'p1' });
    const secondParent = Object.assign(new SlotParent(), { id: 'p2' });
    const first = Object.assign(new SlotProfile(), {
        id: 'd1', parentId: 'p1', parent: firstParent,
    });
    const second = Object.assign(new SlotProfile(), {
        id: 'd2', parentId: 'p2', parent: secondParent,
    });
    firstParent.profile = first;
    secondParent.profile = second;
    db.parents.attach(firstParent);
    db.parents.attach(secondParent);
    for (const profile of order === 'first-first'
        ? [first, second]
        : [second, first]) db.profiles.attach(profile);
    return { db, firstParent, secondParent, first, second };
}

async function stored(db: SlotContext): Promise<Array<{
    id: string; parent_id: string | null;
}>> {
    return (await db.database.connection.query<{
        id: string; parent_id: string | null;
    }>({
        text: 'select id, parent_id from slot_profiles order by id', values: [],
    })).rows;
}

describe('one-to-one state machine', () => {
    it.each(['first-first', 'second-first'] as const)(
        'replaces a required cascade slot when tracked %s',
        async order => {
            const value = await graph(DeleteBehavior.Cascade, false, order);
            value.first.parent = value.secondParent;

            value.db.changeTracker.detectChanges();
            await expect(value.db.saveChanges()).resolves.toBe(2);

            expect(await stored(value.db)).toEqual([
                { id: 'd1', parent_id: 'p2' },
            ]);
            await value.db.dispose();
        },
    );

    it('vacates an optional slot before assigning its replacement', async () => {
        const value = await graph(DeleteBehavior.SetNull, true);
        value.first.parent = value.secondParent;

        value.db.changeTracker.detectChanges();
        expect(value.db.entry(value.second)?.state).toBe(EntityState.Modified);
        await expect(value.db.saveChanges()).resolves.toBe(2);

        expect(await stored(value.db)).toEqual([
            { id: 'd1', parent_id: 'p2' },
            { id: 'd2', parent_id: null },
        ]);
        await value.db.dispose();
    });

    it.each([DeleteBehavior.NoAction, DeleteBehavior.Restrict])(
        'rejects occupied required %s replacement without partial mutation',
        async behavior => {
            const value = await graph(behavior, false);
            value.first.parent = value.secondParent;

            expect(() => {
                value.db.changeTracker.detectChanges();
            }).toThrow('Required relationship \'SlotProfile.parent\' was severed');
            expect(value.first.parentId).toBe('p1');
            expect(value.second.parentId).toBe('p2');
            expect(value.firstParent.profile).toBe(value.first);
            expect(value.secondParent.profile).toBe(value.second);
            expect(value.db.entry(value.first)?.state).toBe(EntityState.Unchanged);
            expect(value.db.entry(value.second)?.state).toBe(EntityState.Unchanged);
            await value.db.dispose();
        },
    );

    it.each([false, true])(
        'rejects a direct swap before mutation when optional is %s',
        async optional => {
            const value = await graph(
                optional ? DeleteBehavior.SetNull : DeleteBehavior.Cascade,
                optional,
            );
            value.first.parent = value.secondParent;
            value.second.parent = value.firstParent;

            expect(() => {
                value.db.changeTracker.detectChanges();
            }).toThrow('cannot atomically swap one-to-one relationships');
            expect(value.first.parentId).toBe('p1');
            expect(value.second.parentId).toBe('p2');
            expect(value.db.entry(value.first)?.state).toBe(EntityState.Unchanged);
            expect(value.db.entry(value.second)?.state).toBe(EntityState.Unchanged);
            await value.db.dispose();
        },
    );
});
