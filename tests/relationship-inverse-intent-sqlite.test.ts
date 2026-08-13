import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, DeleteBehavior, EntityState } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';

class IntentParent {
    public id = '';
    public children: IntentChild[] = [];
    public profile: IntentProfile | null = null;
}

class IntentChild {
    public id = '';
    public parentId: string | null = null;
    public parent: IntentParent | null = null;
}

class IntentProfile {
    public id = '';
    public parentId = '';
    public parent: IntentParent | null = null;
}

class InverseIntentContext extends DbContext {
    public parents = this.set(IntentParent);
    public children = this.set(IntentChild);
    public profiles = this.set(IntentProfile);

    constructor(
        private readonly behavior: DeleteBehavior,
        private readonly optional = false,
    ) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(IntentParent, entity => {
            entity.toTable('intent_parents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
        });
        model.entity(IntentChild, entity => {
            entity.toTable('intent_children');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            const foreignKey = entity.property(row => row.parentId)
                .hasColumnName('parent_id').hasColumnType('text');
            if (this.optional) foreignKey.isOptional();
            else foreignKey.isRequired();
            entity.hasOne(IntentParent, row => row.parent)
                .withMany(parent => parent.children)
                .hasForeignKey(row => row.parentId)
                .onDelete(this.behavior);
        });
        model.entity(IntentProfile, entity => {
            entity.toTable('intent_profiles');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.parentId).hasColumnName('parent_id')
                .hasColumnType('text').isRequired();
            entity.hasOne(IntentParent, row => row.parent)
                .withOne(parent => parent.profile)
                .hasForeignKey(row => row.parentId);
        });
    }
}

async function open(
    behavior = DeleteBehavior.Cascade,
    optional = false,
): Promise<InverseIntentContext> {
    const db = InverseIntentContext.create(behavior, optional);
    await db.database.connection.query({
        text: db.database.createScript(), values: [],
    });
    await db.database.connection.query({
        text: 'insert into intent_parents (id) values (?), (?), (?)',
        values: ['p1', 'p2', 'p3'],
    });
    await db.database.connection.query({
        text: 'insert into intent_children (id, parent_id) values (?, ?)',
        values: ['c', 'p1'],
    });
    await db.database.connection.query({
        text: 'insert into intent_profiles (id, parent_id) values (?, ?)',
        values: ['profile', 'p1'],
    });
    return db;
}

function trackedMove(
    db: InverseIntentContext,
    order: 'old-first' | 'new-first',
): { oldParent: IntentParent; newParent: IntentParent; child: IntentChild } {
    const oldParent = Object.assign(new IntentParent(), { id: 'p1' });
    const newParent = Object.assign(new IntentParent(), { id: 'p2' });
    const child = Object.assign(new IntentChild(), {
        id: 'c', parentId: 'p1', parent: oldParent,
    });
    oldParent.children = [child];
    for (const parent of order === 'old-first'
        ? [oldParent, newParent]
        : [newParent, oldParent]) db.parents.attach(parent);
    db.children.attach(child);
    oldParent.children = [];
    newParent.children = [child];
    return { oldParent, newParent, child };
}

async function storedParent(db: InverseIntentContext): Promise<string | null> {
    const result = await db.database.connection.query<{ parent_id: string | null }>({
        text: 'select parent_id from intent_children where id = ?', values: ['c'],
    });
    return result.rows[0]?.parent_id ?? null;
}

describe('relationship inverse intent resolution', () => {
    it.each(['old-first', 'new-first'] as const)(
        'moves a required cascade dependent when tracked %s',
        async order => {
            const db = await open();
            const { oldParent, newParent, child } = trackedMove(db, order);

            db.changeTracker.detectChanges();

            expect(db.entry(child)?.state).toBe(EntityState.Modified);
            expect(child.parent).toBe(newParent);
            expect(child.parentId).toBe('p2');
            expect(oldParent.children).toEqual([]);
            expect(newParent.children).toEqual([child]);
            await expect(db.saveChanges()).resolves.toBe(1);
            expect(await storedParent(db)).toBe('p2');
            await db.dispose();
        },
    );

    it.each([DeleteBehavior.NoAction, DeleteBehavior.Restrict])(
        'moves a required %s dependent without interpreting an orphan',
        async behavior => {
            const db = await open(behavior);
            const { child, newParent } = trackedMove(db, 'old-first');

            expect(() => {
                db.changeTracker.detectChanges();
            }).not.toThrow();
            expect(child.parent).toBe(newParent);
            expect(db.entry(child)?.state).toBe(EntityState.Modified);
            await expect(db.saveChanges()).resolves.toBe(1);
            expect(await storedParent(db)).toBe('p2');
            await db.dispose();
        },
    );

    it('moves an optional dependent instead of clearing it', async () => {
        const db = await open(DeleteBehavior.SetNull, true);
        const { child, newParent } = trackedMove(db, 'old-first');

        db.changeTracker.detectChanges();

        expect(child.parent).toBe(newParent);
        expect(child.parentId).toBe('p2');
        expect(db.entry(child)?.state).toBe(EntityState.Modified);
        await db.dispose();
    });

    it('moves a one-to-one dependent without deleting it', async () => {
        const db = await open();
        const oldParent = Object.assign(new IntentParent(), { id: 'p1' });
        const newParent = Object.assign(new IntentParent(), { id: 'p2' });
        const profile = Object.assign(new IntentProfile(), {
            id: 'profile', parentId: 'p1', parent: oldParent,
        });
        oldParent.profile = profile;
        db.parents.attach(oldParent);
        db.parents.attach(newParent);
        db.profiles.attach(profile);
        oldParent.profile = null;
        newParent.profile = profile;

        db.changeTracker.detectChanges();

        expect(profile.parent).toBe(newParent);
        expect(profile.parentId).toBe('p2');
        expect(db.entry(profile)?.state).toBe(EntityState.Modified);
        await db.dispose();
    });

    it('rejects two final inverse owners deterministically', async () => {
        const db = await open();
        const { oldParent, child } = trackedMove(db, 'old-first');
        const third = Object.assign(new IntentParent(), { id: 'p3' });
        db.parents.attach(third);
        oldParent.children = [];
        third.children = [child];
        const second = db.changeTracker.entries()
            .map(entry => entry.entity)
            .find(entity => entity instanceof IntentParent && entity.id === 'p2');
        if (!(second instanceof IntentParent)) throw new Error('Expected p2.');
        second.children = [child];

        expect(() => {
            db.changeTracker.detectChanges();
        }).toThrow(
            'appears in more than one final inverse navigation',
        );
        await db.dispose();
    });
});
