import { DbContext, DeleteBehavior, EntityState, type DbContextOptionsBuilder, type ModelBuilder } from '../packages/core/src';
import { detectTrackedCascades } from '../packages/core/src/tracking/relationship-delete-detector';
import { captureRelationshipDetectionValues } from '../packages/core/src/tracking/relationship-detection-values';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { contextModel, internalChangeTracker } from './support/public-api-internals';
import * as graphModule from '../packages/core/src/tracking/tracked-cascade-graph';

class CascadeRoot {
    public id = 0; public leftChildren: MultiChild[] = []; public rightChildren: MultiChild[] = [];
}
class MultiChild {
    public id = 0; public leftId: number | null = null; public rightId: number | null = null; public left: CascadeRoot | null = null; public right: CascadeRoot | null = null;
}
class MultipleContext extends DbContext {
    public roots = this.set(CascadeRoot);
    public children = this.set(MultiChild);
    constructor(private readonly setNullLeft = false, private readonly rightBehavior = DeleteBehavior.Cascade) {
        super();
    }
    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }
    protected override model(model: ModelBuilder): void {
        model.entity(CascadeRoot, entity => {
            entity.toTable('cascade_roots'); entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
        });
        model.entity(MultiChild, entity => {
            entity.toTable('multi_children'); entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
            entity.property(row => row.leftId).hasColumnType('integer');
            entity.property(row => row.rightId).hasColumnType('integer');
            entity.hasOne(CascadeRoot, row => row.left).withMany(row => row.leftChildren)
                .hasForeignKey(row => row.leftId).onDelete(this.setNullLeft ? DeleteBehavior.SetNull : DeleteBehavior.Cascade);
            entity.hasOne(CascadeRoot, row => row.right).withMany(row => row.rightChildren)
                .hasForeignKey(row => row.rightId).onDelete(this.rightBehavior);
        });
    }
}

class CompositeRoot {
    public scope = 1; public id = 0; public leftChildren: CompositeDependent[] = []; public rightChildren: CompositeDependent[] = [];
}
class CompositeDependent {
    public id = 0; public scope: number | null = 1; public leftId: number | null = null; public rightId: number | null = null; public left: CompositeRoot | null = null; public right: CompositeRoot | null = null;
}
class CompositeCascadeContext extends DbContext {
    public roots = this.set(CompositeRoot);
    public children = this.set(CompositeDependent);
    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }
    protected override model(model: ModelBuilder): void {
        model.entity(CompositeRoot, entity => {
            entity.toTable('composite_roots'); entity.hasKey(row => [row.scope, row.id]);
            entity.property(row => row.scope).hasColumnType('integer').isRequired();
            entity.property(row => row.id).hasColumnType('integer').isRequired();
        });
        model.entity(CompositeDependent, entity => {
            entity.toTable('composite_dependents'); entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
            for (const property of ['scope', 'leftId', 'rightId'] as const) entity.property(property).hasColumnType('integer');
            entity.hasOne(CompositeRoot, row => row.left).withMany(row => row.leftChildren)
                .hasForeignKey(row => [row.scope, row.leftId]).onDelete(DeleteBehavior.SetNull);
            entity.hasOne(CompositeRoot, row => row.right).withMany(row => row.rightChildren)
                .hasForeignKey(row => [row.scope, row.rightId]).onDelete(DeleteBehavior.Cascade);
        });
    }
}

async function openMultiple(setNullLeft = false, rightId = 1): Promise<MultipleContext> {
    const db = MultipleContext.create(setNullLeft);
    await db.database.ensureCreated();
    await db.database.connection.query({ text: 'insert into cascade_roots values (1), (2)', values: [] });
    await db.database.connection.query({ text: 'insert into multi_children (id, leftId, rightId) values (1, 1, ?)', values: [rightId] });
    return db;
}

describe('cascade relationships sharing a dependent', () => {
    afterEach(() => jest.restoreAllMocks());
    it('clears every relationship to the same deleted principal and queues the dependent once', async () => {
        const db = await openMultiple();
        try {
            const roots = await db.roots.include(row => row.leftChildren).include(row => row.rightChildren).orderBy(row => row.id).toArray();
            const child = roots[0].leftChildren[0];
            expect(roots[0].rightChildren[0]).toBe(child);
            db.roots.remove(roots[0]);
            db.changeTracker.detectChanges();
            expect(child.left).toBeNull(); expect(child.right).toBeNull();
            expect(roots[0].leftChildren).toEqual([]); expect(roots[0].rightChildren).toEqual([]);
            expect(db.entry(child)?.state).toBe(EntityState.Deleted);
            await expect(db.saveChanges()).resolves.toBe(2);
            expect(await db.children.count()).toBe(0);
        } finally {
            await db.dispose();
        }
    });

    it.each([false, true])('preserves the initial dependent-state boundary when another principal is processed (accessor=%s)', async accessor => {
        const db = await openMultiple(false, 2);
        try {
            const roots = await db.roots.include(row => row.leftChildren).include(row => row.rightChildren).orderBy(row => row.id).toArray();
            const child = roots[0].leftChildren[0];
            if (accessor) {
                let left = child.left;
                Object.defineProperty(child, 'left', { get: () => left, set: (value: CascadeRoot | null) => {
                    left = value;
                } });
            }
            for (const root of roots) db.roots.remove(root);
            db.changeTracker.detectChanges();
            expect(child.left).toBeNull();
            expect(child.right).toBe(roots[1]);
            expect(roots[1].rightChildren).toEqual([child]);
            await expect(db.saveChanges()).resolves.toBe(3);
        } finally {
            await db.dispose();
        }
    });

    it('keeps SetNull independent from another relationship on the same dependent', async () => {
        const db = await openMultiple(true, 2);
        try {
            const roots = await db.roots.orderBy(row => row.id).toArray();
            const child = await db.children.single();
            db.roots.remove(roots[0]);
            const tracker = internalChangeTracker(db.changeTracker);
            detectTrackedCascades(tracker, contextModel(db), captureRelationshipDetectionValues(tracker.entries()));
            expect(child.leftId).toBeNull();
            expect(child.rightId).toBe(2);
            expect(db.entry(child)?.state).toBe(EntityState.Unchanged);
            await expect(db.saveChanges()).resolves.toBe(2);
            expect(await db.children.count()).toBe(1);
        } finally {
            await db.dispose();
        }
    });
    it('preserves a later principal detached by an accessor during an earlier cascade', async () => {
        const db = await openMultiple();
        try {
            await db.database.connection.query({ text: 'insert into multi_children (id, leftId, rightId) values (2, 2, 2)', values: [] });
            const roots = await db.roots.include(row => row.leftChildren).include(row => row.rightChildren).orderBy(row => row.id).toArray();
            const first = roots[0].leftChildren[0];
            const second = roots[1].leftChildren[0];
            let stored = first.left;
            Object.defineProperty(first, 'left', {
                get: () => stored,
                set: (value: CascadeRoot | null) => {
                    stored = value;
                    if (value === null) db.roots.detach(roots[1]);
                },
            });
            for (const root of roots) db.roots.remove(root);
            db.changeTracker.detectChanges();
            expect(db.entry(roots[1])).toBeUndefined();
            expect(db.entry(second)?.state).toBe(EntityState.Unchanged);
            expect(second.left).toBe(roots[1]); expect(second.right).toBe(roots[1]);
            await expect(db.saveChanges()).resolves.toBe(2);
            expect(await db.children.count()).toBe(1);
            expect(await db.roots.count()).toBe(1);
        } finally {
            await db.dispose();
        }
    });

    it.each([false, true])('keeps an added dependent detached when more than one relationship cascades (accessor=%s)', async accessor => {
        const db = await openMultiple();
        try {
            const root = await db.roots.where(row => row.id.eq(1)).single();
            const added = Object.assign(new MultiChild(), { id: 10, leftId: 1, rightId: 1, left: root, right: root });
            const entry = db.children.add(added);
            if (accessor) {
                let left: CascadeRoot | null = added.left;
                Object.defineProperty(added, 'left', { get: () => left, set: (value: CascadeRoot | null) => {
                    left = value;
                } });
            }
            db.roots.remove(root);
            db.changeTracker.detectChanges();
            expect(db.entry(added)).toBeUndefined();
            expect(entry.state).toBe(EntityState.Detached);
            expect(added.left).toBeNull(); expect(added.right).toBeNull();
            expect(root.leftChildren).toEqual([]); expect(root.rightChildren).toEqual([]);
        } finally {
            await db.dispose();
        }
    });
    it('leaves a detached added dependent alone when a second principal is processed', async () => {
        const db = await openMultiple();
        try {
            const roots = await db.roots.orderBy(row => row.id).toArray();
            const added = Object.assign(new MultiChild(), { id: 10, leftId: 1, rightId: 2, left: roots[0], right: roots[1] });
            const receipt = db.children.add(added);
            for (const root of roots) db.roots.remove(root);
            db.changeTracker.detectChanges();
            expect(receipt.state).toBe(EntityState.Detached);
            expect(db.entry(added)).toBeUndefined();
            expect(added.left).toBeNull();
            expect(added.right).toBe(roots[1]);
            expect(roots[1].rightChildren).toContain(added);
        } finally {
            await db.dispose();
        }
    });
    it.each([false, true])('honors a navigation redirected by an earlier cascade accessor (SetNull=%s)', async setNull => {
        const db = await openMultiple(setNull);
        try {
            await db.database.connection.query({ text: 'insert into cascade_roots values (3)', values: [] });
            await db.database.connection.query({ text: 'insert into multi_children (id, leftId, rightId) values (2, 3, 3)', values: [] });
            const roots = await db.roots.include(row => row.leftChildren).include(row => row.rightChildren).orderBy(row => row.id).toArray();
            const first = roots[0].leftChildren[0];
            const redirected = roots[2].rightChildren[0];
            let stored = first.left;
            Object.defineProperty(first, 'left', {
                get: () => stored,
                set: (value: CascadeRoot | null) => {
                    stored = value;
                    if (value === null) redirected.right = roots[1];
                },
            });
            db.roots.remove(roots[0]); db.roots.remove(roots[1]);
            const Graph = graphModule.TrackedCascadeGraph;
            const preparation = jest.spyOn(graphModule, 'TrackedCascadeGraph').mockImplementation((...args) => new Graph(...args));
            db.changeTracker.detectChanges();
            expect(db.entry(redirected)?.state).toBe(EntityState.Deleted);
            expect(redirected.right).toBeNull();
            expect(redirected.left).toBe(roots[2]);
            expect(roots[2].leftChildren).toEqual([redirected]);
            expect(preparation).not.toHaveBeenCalled();
        } finally {
            await db.dispose();
        }
    });
    it.each([DeleteBehavior.NoAction, DeleteBehavior.Restrict])('leaves %s relationships for database enforcement in accessor graphs', async behavior => {
        const db = MultipleContext.create(true, behavior);
        try {
            await db.database.ensureCreated();
            await db.database.connection.query({ text: 'insert into cascade_roots values (1)', values: [] });
            await db.database.connection.query({ text: 'insert into multi_children (id, leftId, rightId) values (1, 1, 1)', values: [] });
            const root = await db.roots.include(row => row.leftChildren).include(row => row.rightChildren).single();
            const child = root.leftChildren[0];
            let right = child.right;
            Object.defineProperty(child, 'right', { get: () => right, set: (value: CascadeRoot | null) => {
                right = value;
            } });
            db.roots.remove(root);
            db.changeTracker.detectChanges();
            expect(child.leftId).toBeNull();
            expect(child.left).toBeNull();
            expect(child.rightId).toBe(1);
            expect(child.right).toBe(root);
            expect(db.entry(child)?.state).not.toBe(EntityState.Deleted);
        } finally {
            await db.dispose();
        }
    });
    it('rechecks overlapping composite FK parts after SetNull before processing another principal', async () => {
        const db = CompositeCascadeContext.create();
        try {
            await db.database.ensureCreated();
            await db.database.connection.query({ text: 'insert into composite_roots (scope, id) values (1, 1), (1, 2)', values: [] });
            await db.database.connection.query({ text: 'insert into composite_dependents (id, scope, leftId, rightId) values (1, 1, 1, 2)', values: [] });
            const roots = await db.roots.orderBy(row => row.id).toArray();
            const child = await db.children.single();
            for (const root of roots) db.roots.remove(root);
            const tracker = internalChangeTracker(db.changeTracker);
            detectTrackedCascades(tracker, contextModel(db), captureRelationshipDetectionValues(tracker.entries()));
            expect(child.scope).toBeNull();
            expect(child.leftId).toBeNull();
            expect(db.entry(child)?.state).toBe(EntityState.Unchanged);
            await expect(db.saveChanges()).resolves.toBe(3);
            expect(await db.children.count()).toBe(1);
            expect(await db.roots.count()).toBe(0);
            expect((await db.database.connection.query({ text: 'pragma foreign_key_check', values: [] })).rows).toEqual([]);
        } finally {
            await db.dispose();
        }
    });
});
