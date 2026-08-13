import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, DeleteBehavior, EntityState } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';

class SoftSlotParent {
    public id = '';
    public profile: SoftSlotProfile | null = null;
}

class SoftSlotProfile {
    public id = '';
    public parentId: string | null = null;
    public deletedAt: Date | null = null;
    public parent: SoftSlotParent | null = null;
}

class SoftSlotContext extends DbContext {
    public parents = this.set(SoftSlotParent);
    public profiles = this.set(SoftSlotProfile);

    constructor(private readonly optional: boolean) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(SoftSlotParent, entity => {
            entity.toTable('soft_slot_parents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
        });
        model.entity(SoftSlotProfile, entity => {
            entity.toTable('soft_slot_profiles');
            entity.hasKey(row => row.id);
            entity.softDelete(row => row.deletedAt);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            const foreignKey = entity.property(row => row.parentId)
                .hasColumnName('parent_id').hasColumnType('text');
            if (this.optional) foreignKey.isOptional();
            else foreignKey.isRequired();
            entity.property(row => row.deletedAt).hasColumnName('deleted_at')
                .hasColumnType('timestamp').isOptional();
            entity.hasOne(SoftSlotParent, row => row.parent)
                .withOne(row => row.profile)
                .hasForeignKey(row => row.parentId)
                .onDelete(this.optional
                    ? DeleteBehavior.SetNull
                    : DeleteBehavior.Cascade);
        });
    }
}

interface SoftSlotGraph {
    readonly db: SoftSlotContext;
    readonly firstParent: SoftSlotParent;
    readonly secondParent: SoftSlotParent;
    readonly incoming: SoftSlotProfile;
    readonly occupant: SoftSlotProfile;
}

async function graph(
    optional: boolean,
    order: 'incoming-first' | 'occupant-first',
): Promise<SoftSlotGraph> {
    const db = SoftSlotContext.create(optional);
    await db.database.connection.query({
        text: db.database.createScript(), values: [],
    });
    await db.database.connection.query({
        text: 'insert into soft_slot_parents (id) values (?), (?)',
        values: ['p1', 'p2'],
    });
    await db.database.connection.query({
        text: 'insert into soft_slot_profiles (id, parent_id, deleted_at) ' +
            'values (?, ?, ?), (?, ?, ?)',
        values: ['d1', 'p1', null, 'd2', 'p2', null],
    });
    const firstParent = Object.assign(new SoftSlotParent(), { id: 'p1' });
    const secondParent = Object.assign(new SoftSlotParent(), { id: 'p2' });
    const incoming = Object.assign(new SoftSlotProfile(), {
        id: 'd1', parentId: 'p1', parent: firstParent,
    });
    const occupant = Object.assign(new SoftSlotProfile(), {
        id: 'd2', parentId: 'p2', parent: secondParent,
    });
    firstParent.profile = incoming;
    secondParent.profile = occupant;
    db.parents.attach(firstParent);
    db.parents.attach(secondParent);
    const profiles = order === 'incoming-first'
        ? [incoming, occupant]
        : [occupant, incoming];
    profiles.forEach(profile => db.profiles.attach(profile));
    incoming.parent = secondParent;
    return { db, firstParent, secondParent, incoming, occupant };
}

describe('one-to-one soft-delete displacement', () => {
    it.each(['incoming-first', 'occupant-first'] as const)(
        'rejects a required full-unique replacement tracked %s',
        async order => {
            const value = await graph(false, order);

            expect(() => {
                value.db.changeTracker.detectChanges();
            }).toThrow(
                'cannot displace a soft-deletable dependent',
            );
            expect(value.incoming.parentId).toBe('p1');
            expect(value.occupant.parentId).toBe('p2');
            expect(value.firstParent.profile).toBe(value.incoming);
            expect(value.secondParent.profile).toBe(value.occupant);
            expect(value.db.entry(value.incoming)?.state)
                .toBe(EntityState.Unchanged);
            expect(value.db.entry(value.occupant)?.state)
                .toBe(EntityState.Unchanged);
            await value.db.dispose();
        },
    );

    it('keeps the fail-closed contract with a partial unique index', async () => {
        const value = await graph(false, 'incoming-first');
        await value.db.database.connection.query({
            text: 'drop index ux_soft_slot_profiles_parent_id', values: [],
        });
        await value.db.database.connection.query({
            text: 'create unique index ux_soft_slot_profiles_live_parent ' +
                'on soft_slot_profiles (parent_id) where deleted_at is null',
            values: [],
        });

        expect(() => {
            value.db.changeTracker.detectChanges();
        }).toThrow(
            'cannot displace a soft-deletable dependent',
        );
        await value.db.dispose();
    });

    it('rejects an explicitly deleted occupant that retains its slot', async () => {
        const value = await graph(false, 'incoming-first');
        value.db.profiles.remove(value.occupant);

        expect(() => {
            value.db.changeTracker.detectChanges();
        }).toThrow('cannot displace a soft-deletable dependent');
        expect(value.db.entry(value.occupant)?.state).toBe(EntityState.Deleted);
        expect(value.incoming.parentId).toBe('p1');
        expect(value.occupant.parentId).toBe('p2');
        await value.db.dispose();
    });

    it.each(['incoming-first', 'occupant-first'] as const)(
        'vacates an optional slot without soft-deleting it when tracked %s',
        async order => {
            const value = await graph(true, order);

            await expect(value.db.saveChanges()).resolves.toBe(2);
            const stored = (await value.db.database.connection.query({
                text: 'select id, parent_id, deleted_at from ' +
                    'soft_slot_profiles order by id',
                values: [],
            })).rows;
            expect(stored).toEqual([
                { id: 'd1', parent_id: 'p2', deleted_at: null },
                { id: 'd2', parent_id: null, deleted_at: null },
            ]);
            await value.db.dispose();
        },
    );
});
