import type {
    DbContextOptionsBuilder,
    ModelBuilder,
    SaveChangesInterceptor,
} from '../packages/core/src';
import { DbContext } from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';

class UnplannedParent {
    public id = 0;
    public name = '';
    public children: UnplannedChild[] = [];
}

class UnplannedChild {
    public id = '';
    public parentId = 0;
    public parent: UnplannedParent | null = null;
}

class UnplannedRelationshipContext extends DbContext {
    public parents = this.set(UnplannedParent);
    public children = this.set(UnplannedChild);

    constructor(
        private readonly interceptors: readonly SaveChangesInterceptor[] = [],
    ) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
        for (const interceptor of this.interceptors) {
            options.useSaveInterceptor(interceptor);
        }
    }

    protected override model(model: ModelBuilder): void {
        model.entity(UnplannedParent, entity => {
            entity.toTable('unplanned_parents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer')
                .isRequired().useSqliteRowId();
            entity.property(row => row.name).hasColumnType('text').isRequired();
        });
        model.entity(UnplannedChild, entity => {
            entity.toTable('unplanned_children');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.parentId).hasColumnName('parent_id')
                .hasColumnType('integer').isRequired();
            entity.hasOne(UnplannedParent, row => row.parent)
                .withMany(row => row.children)
                .hasForeignKey(row => row.parentId);
        });
    }
}

async function open(
    interceptors: readonly SaveChangesInterceptor[] = [],
): Promise<UnplannedRelationshipContext> {
    const db = UnplannedRelationshipContext.create(interceptors);
    await db.database.connection.query({
        text: db.database.createScript(), values: [],
    });
    await db.database.connection.query({
        text: `insert into unplanned_parents (id, name)
            values (?, ?), (?, ?)`,
        values: [0, 'zero', 2, 'two'],
    });
    await db.database.connection.query({
        text: `insert into unplanned_children (id, parent_id)
            values (?, ?)`,
        values: ['existing', 2],
    });
    return db;
}

const planningPaths = [
    'no inspection',
    'detectChanges()',
    'getSavePlan()',
    'getSavePlanDebugView()',
    'no-op interceptor',
] as const;

type PlanningPath = typeof planningPaths[number];

function inspectDependent(
    db: UnplannedRelationshipContext,
    path: PlanningPath,
): void {
    if (path === 'detectChanges()') db.changeTracker.detectChanges();
    if (path === 'getSavePlan()') void db.getSavePlan();
    if (path === 'getSavePlanDebugView()') void db.getSavePlanDebugView();
}

async function occupyNextId(
    db: UnplannedRelationshipContext,
    name: string,
): Promise<void> {
    await db.database.connection.query({
        text: 'insert into unplanned_parents (name) values (?)',
        values: [name],
    });
}

async function storedParentId(
    db: UnplannedRelationshipContext,
    childId: string,
): Promise<number> {
    const result = await db.database.connection.query<{ parent_id: number }>({
        text: 'select parent_id from unplanned_children where id = ?',
        values: [childId],
    });
    return result.rows[0]?.parent_id ?? -1;
}

describe('unplanned generated relationships on SQLite', () => {
    it.each(planningPaths)(
        'retargets an added dependent after %s',
        async path => {
            const db = await open(path === 'no-op interceptor'
                ? [{ savingChanges: () => undefined }]
                : []);
            const parent = Object.assign(new UnplannedParent(), { name: 'new' });
            const child = Object.assign(new UnplannedChild(), { id: 'added' });
            await expect(db.transaction(async tx => {
                tx.parents.add(parent);
                await tx.saveChanges();
                child.parentId = parent.id;
                tx.children.add(child);
                inspectDependent(tx, path);
                throw new Error('abort before child plan');
            })).rejects.toThrow('abort before child plan');
            await occupyNextId(db, 'occupy rolled-back ID');

            await expect(db.saveChanges()).resolves.toBe(2);
            expect(parent.id).toBe(4);
            expect(child).toMatchObject({ parentId: 4, parent });
            await expect(storedParentId(db, child.id)).resolves.toBe(4);
            await db.dispose();
        });

    it.each(planningPaths)(
        'fails closed for an existing dependent after %s',
        async path => {
            const db = await open(path === 'no-op interceptor'
                ? [{ savingChanges: () => undefined }]
                : []);
            const child = await db.children.find('existing');
            if (!child) throw new Error('Expected existing child.');
            const parent = Object.assign(new UnplannedParent(), { name: 'new' });
            await expect(db.transaction(async tx => {
                tx.parents.add(parent);
                await tx.saveChanges();
                child.parentId = parent.id;
                inspectDependent(tx, path);
                throw new Error('abort before child detection');
            })).rejects.toThrow('abort before child detection');
            await occupyNextId(db, 'occupy rolled-back ID');

            await expect(db.saveChanges()).rejects.toThrow(
                'has not been generated yet',
            );
            await expect(storedParentId(db, child.id)).resolves.toBe(2);
            await db.dispose();
        });

    it('requires explicit navigation for a restored zero', async () => {
        const db = await open();
        const parent = Object.assign(new UnplannedParent(), { name: 'new' });
        const child = Object.assign(new UnplannedChild(), { id: 'repeated' });
        await expect(db.transaction(async tx => {
            tx.parents.add(parent);
            await tx.saveChanges();
            child.parentId = parent.id;
            tx.children.add(child);
            await tx.saveChanges();
            throw new Error('abort first attempt');
        })).rejects.toThrow('abort first attempt');
        await occupyNextId(db, 'first blocker');
        await expect(db.transaction(async tx => {
            await tx.saveChanges();
            throw new Error('abort second attempt');
        })).rejects.toThrow('abort second attempt');
        expect(child).toMatchObject({ parentId: 0, parent: null });
        await expect(db.parents.find(0)).resolves.toMatchObject({ id: 0 });

        await expect(db.saveChanges()).rejects.toThrow(
            'restored after a generated-key rollback',
        );
        expect(child).toMatchObject({ parentId: 0, parent: null });
        await expect(storedParentId(db, child.id)).resolves.toBe(-1);

        const stableZero = await db.parents.find(0);
        if (!stableZero) throw new Error('Expected stable zero parent.');
        child.parent = stableZero;
        await expect(db.saveChanges()).resolves.toBe(2);
        expect(parent.id).toBe(4);
        expect(child).toMatchObject({ parentId: 0, parent: stableZero });
        await expect(storedParentId(db, child.id)).resolves.toBe(0);
        await db.dispose();
    });
});
