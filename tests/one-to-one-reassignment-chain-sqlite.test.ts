import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, DeleteBehavior } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';

class ChainParent {
    public id = '';
    public profile: ChainProfile | null = null;
}

class ChainProfile {
    public id = '';
    public parentId: string | null = null;
    public parent: ChainParent | null = null;
}

class ChainContext extends DbContext {
    public parents = this.set(ChainParent);
    public profiles = this.set(ChainProfile);

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
        model.entity(ChainParent, entity => {
            entity.toTable('chain_parents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
        });
        model.entity(ChainProfile, entity => {
            entity.toTable('chain_profiles');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            const foreignKey = entity.property(row => row.parentId)
                .hasColumnName('parent_id').hasColumnType('text');
            if (this.optional) foreignKey.isOptional();
            else foreignKey.isRequired();
            entity.hasOne(ChainParent, row => row.parent)
                .withOne(row => row.profile)
                .hasForeignKey(row => row.parentId)
                .onDelete(this.behavior);
        });
    }
}

interface ChainGraph {
    readonly db: ChainContext;
    readonly parents: readonly ChainParent[];
    readonly profiles: readonly ChainProfile[];
}

async function graph(
    count: number,
    order: readonly number[],
    behavior: DeleteBehavior,
    optional: boolean,
): Promise<ChainGraph> {
    const db = ChainContext.create(behavior, optional);
    await db.database.connection.query({
        text: db.database.createScript(), values: [],
    });
    const parents = Array.from({ length: count + 1 }, (_, index) =>
        Object.assign(new ChainParent(), { id: `p${String(index + 1)}` }));
    const profiles = Array.from({ length: count }, (_, index) =>
        Object.assign(new ChainProfile(), {
            id: `d${String(index + 1)}`,
            parentId: parents[index]?.id,
            parent: parents[index],
        }));
    profiles.forEach((profile, index) => {
        const parent = parents[index];
        parent.profile = profile;
    });
    await db.database.connection.query({
        text: `insert into chain_parents (id) values ${parents
            .map(() => '(?)').join(', ')}`,
        values: parents.map(parent => parent.id),
    });
    await db.database.connection.query({
        text: `insert into chain_profiles (id, parent_id) values ${profiles
            .map(() => '(?, ?)').join(', ')}`,
        values: profiles.flatMap(profile => [profile.id, profile.parentId]),
    });
    parents.forEach(parent => db.parents.attach(parent));
    order.forEach(index => db.profiles.attach(profiles[index]));
    return { db, parents, profiles };
}

async function stored(db: ChainContext): Promise<Array<{
    id: string; parent_id: string | null;
}>> {
    return (await db.database.connection.query<{
        id: string; parent_id: string | null;
    }>({
        text: 'select id, parent_id from chain_profiles order by id', values: [],
    })).rows;
}

const behaviors: ReadonlyArray<readonly [
    string, DeleteBehavior, boolean,
]> = [
    ['required cascade', DeleteBehavior.Cascade, false],
    ['required no action', DeleteBehavior.NoAction, false],
    ['required restrict', DeleteBehavior.Restrict, false],
    ['optional set null', DeleteBehavior.SetNull, true],
];

const twoEntryOrders: ReadonlyArray<readonly [string, readonly number[]]> = [
    ['incoming first', [0, 1]],
    ['terminal first', [1, 0]],
];

describe('one-to-one reassignment chains', () => {
    it.each(behaviors.flatMap(([label, behavior, optional]) =>
        twoEntryOrders.map(([orderLabel, order]) => [
            label, behavior, optional, orderLabel, order,
        ] as const)))(
        'persists a direct %s chain tracked %s',
        async (_label, behavior, optional, _orderLabel, order) => {
            const value = await graph(2, order, behavior, optional);
            value.profiles[0].parent = value.parents[1];
            value.profiles[1].parent = value.parents[2];

            await expect(value.db.saveChanges()).resolves.toBe(2);
            expect(await stored(value.db)).toEqual([
                { id: 'd1', parent_id: 'p2' },
                { id: 'd2', parent_id: 'p3' },
            ]);
            await value.db.dispose();
        },
    );

    it.each(behaviors.flatMap(([label, behavior, optional]) =>
        twoEntryOrders.map(([orderLabel, order]) => [
            label, behavior, optional, orderLabel, order,
        ] as const)))(
        'persists an FK-only %s chain tracked %s',
        async (_label, behavior, optional, _orderLabel, order) => {
            const value = await graph(2, order, behavior, optional);
            value.profiles[0].parentId = 'p2';
            value.profiles[1].parentId = 'p3';

            await expect(value.db.saveChanges()).resolves.toBe(2);
            expect(await stored(value.db)).toEqual([
                { id: 'd1', parent_id: 'p2' },
                { id: 'd2', parent_id: 'p3' },
            ]);
            await value.db.dispose();
        },
    );

    it.each([
        [[0, 1, 2]], [[0, 2, 1]], [[1, 0, 2]],
        [[1, 2, 0]], [[2, 0, 1]], [[2, 1, 0]],
    ])('persists a three-step chain tracked as %j', async order => {
        const value = await graph(3, order, DeleteBehavior.Cascade, false);
        value.profiles.forEach((profile, index) => {
            profile.parent = value.parents[index + 1];
        });

        await expect(value.db.saveChanges()).resolves.toBe(3);
        expect(await stored(value.db)).toEqual([
            { id: 'd1', parent_id: 'p2' },
            { id: 'd2', parent_id: 'p3' },
            { id: 'd3', parent_id: 'p4' },
        ]);
        await value.db.dispose();
    });

    it.each(twoEntryOrders)(
        'rejects an FK cycle tracked %s before mutation',
        async (_label, order) => {
            const value = await graph(
                2, order, DeleteBehavior.Cascade, false,
            );
            value.profiles[0].parentId = 'p2';
            value.profiles[1].parentId = 'p1';

            expect(() => {
                value.db.changeTracker.detectChanges();
            })
                .toThrow('cannot atomically swap one-to-one relationships');
            expect(value.profiles.map(profile => profile.parentId))
                .toEqual(['p2', 'p1']);
            expect(value.parents.map(parent => parent.profile?.id ?? null))
                .toEqual(['d1', 'd2', null]);
            await value.db.dispose();
        },
    );
});
