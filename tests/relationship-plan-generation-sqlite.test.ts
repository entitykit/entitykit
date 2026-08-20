import type {
    DbContextOptionsBuilder,
    ModelBuilder,
    SaveChangesInterceptor,
} from '../packages/core/src';
import { DbContext, EntityState } from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { requireDefined } from './support/require-defined';

class PlanParent {
    public id = '';
    public children: PlanChild[] = [];
}

class PlanChild {
    public id = '';
    public parentId: string | null = null;
    public parent: PlanParent | null = null;
}

class PlanContext extends DbContext {
    public parents = this.set(PlanParent);
    public children = this.set(PlanChild);

    constructor(private readonly interceptors: readonly SaveChangesInterceptor[] = []) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
        for (const interceptor of this.interceptors) {
            options.useSaveInterceptor(interceptor);
        }
    }

    protected override model(model: ModelBuilder): void {
        model.entity(PlanParent, entity => {
            entity.toTable('plan_parents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
        });
        model.entity(PlanChild, entity => {
            entity.toTable('plan_children');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.parentId).hasColumnName('parent_id')
                .hasColumnType('text').isOptional();
            entity.hasOne(PlanParent, row => row.parent)
                .withMany(parent => parent.children)
                .hasForeignKey(row => row.parentId);
        });
    }
}

async function openPlanContext(
    interceptors: readonly SaveChangesInterceptor[] = [],
): Promise<PlanContext> {
    const db = PlanContext.create(interceptors);
    await db.database.connection.query({
        text: db.database.createScript(), values: [],
    });
    await db.database.connection.query({
        text: 'insert into plan_parents (id) values (?), (?)',
        values: ['p1', 'p2'],
    });
    await db.database.connection.query({
        text: 'insert into plan_children (id, parent_id) values (?, ?)',
        values: ['c', 'p1'],
    });
    return db;
}

async function loadedChild(db: PlanContext): Promise<PlanChild> {
    const child = requireDefined(await db.children.find('c'));
    await requireDefined(db.entry(child)).reference(row => row.parent).load();
    return child;
}

async function storedParentId(db: PlanContext): Promise<string | null> {
    const result = await db.database.connection.query<{ parent_id: string | null }>({
        text: 'select parent_id from plan_children where id = ?', values: ['c'],
    });
    return requireDefined(result.rows[0]).parent_id;
}

describe('relationship plan generations', () => {
    it('persists an optional FK-only change to an untracked principal', async () => {
        const db = await openPlanContext();
        const child = await loadedChild(db);

        child.parentId = 'p2';
        await expect(db.saveChanges()).resolves.toBe(1);

        expect(child.parentId).toBe('p2');
        expect(child.parent).toBeNull();
        expect(await storedParentId(db)).toBe('p2');
        expect(db.entry(child)?.state).toBe(EntityState.Unchanged);
        await db.dispose();
    });

    it('keeps getSavePlan() preview and execution on the same FK', async () => {
        const db = await openPlanContext();
        const child = await loadedChild(db);
        child.parentId = 'p2';

        const preview = db.getSavePlan();
        expect(child.parent?.id).toBe('p1');
        const repeated = db.getSavePlan();
        expect(child.parent?.id).toBe('p1');
        expect(preview[0]?.statement.values).toContain('p2');
        expect(repeated[0]?.statement.values).toEqual(
            preview[0]?.statement.values,
        );
        await expect(db.saveChanges()).resolves.toBe(1);

        expect(await storedParentId(db)).toBe('p2');
        expect(child.parent).toBeNull();
        await db.dispose();
    });

    it('keeps debug preview and execution on the same FK', async () => {
        const db = await openPlanContext();
        const child = await loadedChild(db);
        child.parentId = 'p2';

        expect(db.getSavePlanDebugView()).toContain('p2');
        await expect(db.saveChanges()).resolves.toBe(1);

        expect(await storedParentId(db)).toBe('p2');
        expect(child.parent).toBeNull();
        await db.dispose();
    });

    it('does not let a no-op interceptor change relationship intent', async () => {
        const db = await openPlanContext([{ savingChanges: () => undefined }]);
        const child = await loadedChild(db);
        child.parentId = 'p2';

        await expect(db.saveChanges()).resolves.toBe(1);

        expect(await storedParentId(db)).toBe('p2');
        expect(child.parent).toBeNull();
        await db.dispose();
    });

    it('keeps ordered interceptor generations idempotent', async () => {
        const calls: string[] = [];
        const generation: {
            child?: PlanChild;
            originalParent: PlanParent | null;
        } = { originalParent: null };
        const db = await openPlanContext([
            { savingChanges: () => {
                calls.push('first');
                expect(requireDefined(generation.child).parent).toBeNull();
                requireDefined(generation.child).parent =
                    generation.originalParent;
            } },
            { savingChanges: () => {
                calls.push('second');
                expect(requireDefined(generation.child).parent)
                    .toBe(generation.originalParent);
                expect(requireDefined(generation.child).parentId).toBe('p1');
                requireDefined(generation.child).parentId = 'p2';
            } },
        ]);
        const child = await loadedChild(db);
        generation.child = child;
        generation.originalParent = child.parent;
        child.parentId = 'p2';

        await expect(db.saveChanges()).resolves.toBe(1);

        expect(calls).toEqual(['first', 'second']);
        expect(await storedParentId(db)).toBe('p2');
        expect(child.parent).toBeNull();
        await db.dispose();
    });

    it('retains relationship intent after provider failure', async () => {
        const db = await openPlanContext();
        const child = await loadedChild(db);
        await db.database.connection.query({
            text: `create trigger reject_plan_update before update on plan_children
                begin select raise(abort, 'blocked'); end`,
            values: [],
        });
        child.parentId = 'p2';

        await expect(db.saveChanges()).rejects.toThrow();

        expect(child.parentId).toBe('p2');
        expect(child.parent?.id).toBe('p1');
        expect(db.entry(child)?.state).toBe(EntityState.Modified);
        expect(await storedParentId(db)).toBe('p1');
        await db.database.connection.query({
            text: 'drop trigger reject_plan_update', values: [],
        });
        await expect(db.saveChanges()).resolves.toBe(1);
        expect(await storedParentId(db)).toBe('p2');
        await db.dispose();
    });

    it('restores relationship acceptance after outer transaction rollback', async () => {
        const db = await openPlanContext();
        const child = await loadedChild(db);
        child.parentId = 'p2';

        await expect(db.transaction(async transaction => {
            await transaction.saveChanges();
            throw new Error('rollback');
        })).rejects.toThrow('rollback');

        expect(await storedParentId(db)).toBe('p1');
        expect(child.parentId).toBe('p2');
        expect(child.parent?.id).toBe('p1');
        expect(db.entry(child)?.state).toBe(EntityState.Modified);
        await expect(db.saveChanges()).resolves.toBe(1);
        expect(await storedParentId(db)).toBe('p2');
        await db.dispose();
    });

    it('loads a dependent reference from its current FK', async () => {
        const db = await openPlanContext();
        const child = requireDefined(await db.children.find('c'));
        child.parentId = 'p2';

        const parent = await requireDefined(db.entry(child))
            .reference(row => row.parent).load();

        expect(parent?.id).toBe('p2');
        expect(child.parent).toBe(parent);
        expect(child.parentId).toBe('p2');
        await db.dispose();
    });
});
