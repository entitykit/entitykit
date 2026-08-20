import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import {
    ContextStateRestorationError,
    DbContext,
    DeleteBehavior,
    EntityState,
} from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { requireDefined } from './support/require-defined';
import { internalChangeTracker } from './support/public-api-internals';

class AtomicParent {
    public id = '';
    public cascadeChildren: AtomicCascadeChild[] = [];
    public restrictedChildren: AtomicRestrictedChild[] = [];
}

class AtomicCascadeChild {
    public id = 0;
    public parentId = '';
    public parent: AtomicParent | null = null;
}

class AtomicRestrictedChild {
    public id = '';
    public parentId = '';
    public parent: AtomicParent | null = null;
}

class AtomicRelationshipContext extends DbContext {
    public parents = this.set(AtomicParent);
    public cascadeChildren = this.set(AtomicCascadeChild);
    public restrictedChildren = this.set(AtomicRestrictedChild);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(AtomicParent, entity => {
            entity.toTable('atomic_parents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
        });
        model.entity(AtomicCascadeChild, entity => {
            entity.toTable('atomic_cascade_children');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer')
                .isRequired().useSqliteRowId();
            entity.property(row => row.parentId).hasColumnName('parent_id')
                .hasColumnType('text').isRequired();
            entity.hasOne(AtomicParent, row => row.parent)
                .withMany(row => row.cascadeChildren)
                .hasForeignKey(row => row.parentId)
                .onDelete(DeleteBehavior.Cascade);
        });
        model.entity(AtomicRestrictedChild, entity => {
            entity.toTable('atomic_restricted_children');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.parentId).hasColumnName('parent_id')
                .hasColumnType('text').isRequired();
            entity.hasOne(AtomicParent, row => row.parent)
                .withMany(row => row.restrictedChildren)
                .hasForeignKey(row => row.parentId)
                .onDelete(DeleteBehavior.NoAction);
        });
    }
}

function graph(addedCascade: boolean): {
    readonly db: AtomicRelationshipContext;
    readonly parent: AtomicParent;
    readonly cascade: AtomicCascadeChild;
    readonly restricted: AtomicRestrictedChild;
} {
    const db = AtomicRelationshipContext.create();
    const parent = Object.assign(new AtomicParent(), { id: 'p1' });
    const cascade = Object.assign(new AtomicCascadeChild(), {
        id: addedCascade ? 0 : 1,
        parentId: 'p1',
        parent,
    });
    const restricted = Object.assign(new AtomicRestrictedChild(), {
        id: 'r1',
        parentId: 'p1',
        parent,
    });
    parent.cascadeChildren = [cascade];
    parent.restrictedChildren = [restricted];
    db.parents.attach(parent);
    if (addedCascade) db.cascadeChildren.add(cascade);
    else db.cascadeChildren.attach(cascade);
    db.restrictedChildren.attach(restricted);
    parent.cascadeChildren = [];
    parent.restrictedChildren = [];
    return { db, parent, cascade, restricted };
}

describe('relationship detection atomicity', () => {
    it('restores an earlier Deleted transition after a later orphan fails', async () => {
        const { db, parent, cascade, restricted } = graph(false);

        expect(() => {
            db.changeTracker.detectChanges();
        }).toThrow(
            'Required relationship \'AtomicRestrictedChild.parent\' was severed',
        );

        expect(db.entry(cascade)?.state).toBe(EntityState.Unchanged);
        expect(db.entry(restricted)?.state).toBe(EntityState.Unchanged);
        expect(cascade.parent).toBe(parent);
        expect(restricted.parent).toBe(parent);
        expect(parent.cascadeChildren).toEqual([]);
        expect(parent.restrictedChildren).toEqual([]);
        await db.dispose();
    });

    it('restores a detached Added entry and its temporary identity', async () => {
        const { db, parent, cascade, restricted } = graph(true);

        expect(() => {
            db.changeTracker.detectChanges();
        }).toThrow(
            'Required relationship \'AtomicRestrictedChild.parent\' was severed',
        );

        expect(db.entry(cascade)?.state).toBe(EntityState.Added);
        expect(db.entry(restricted)?.state).toBe(EntityState.Unchanged);
        expect(cascade.parent).toBe(parent);
        expect(parent.cascadeChildren).toEqual([]);
        expect(() => {
            internalChangeTracker(db.changeTracker).acceptAllChanges();
        }).toThrow(
            'unresolved store-generated identity',
        );
        expect(requireDefined(db.entry(cascade)).state).toBe(EntityState.Added);
        await db.dispose();
    });

    it('restores graph and FK state after an accessor fails during fix-up', async () => {
        const db = AtomicRelationshipContext.create();
        const previous = Object.assign(new AtomicParent(), { id: 'p1' });
        const next = Object.assign(new AtomicParent(), { id: 'p2' });
        const child = Object.assign(new AtomicCascadeChild(), {
            id: 1, parentId: 'p1', parent: previous,
        });
        previous.cascadeChildren = [child];
        db.parents.attach(previous);
        db.parents.attach(next);
        db.cascadeChildren.attach(child);
        let parentId = 'p1';
        let throwNextWrite = true;
        Object.defineProperty(child, 'parentId', {
            configurable: true,
            get: () => parentId,
            set: (value: string) => {
                parentId = value;
                if (throwNextWrite) {
                    throwNextWrite = false;
                    throw new Error('relationship FK setter failed');
                }
            },
        });
        child.parent = next;

        expect(() => {
            db.changeTracker.detectChanges();
        }).toThrow('relationship FK setter failed');
        expect(child.parentId).toBe('p1');
        expect(child.parent).toBe(next);
        expect(previous.cascadeChildren).toEqual([child]);
        expect(next.cascadeChildren).toEqual([]);
        expect(db.entry(child)?.state).toBe(EntityState.Unchanged);
        await db.dispose();
    });

    it('defers detach observers until relationship validation succeeds', async () => {
        const { db, cascade } = graph(true);
        let detachNotifications = 0;
        internalChangeTracker(db.changeTracker).observeDetached(() => {
            detachNotifications += 1;
            return undefined;
        });

        expect(() => {
            db.changeTracker.detectChanges();
        }).toThrow('AtomicRestrictedChild.parent');

        expect(detachNotifications).toBe(0);
        expect(db.entry(cascade)?.state).toBe(EntityState.Added);
        await db.dispose();
    });

    it('rolls back relationship state when a detach observer fails', async () => {
        const db = AtomicRelationshipContext.create();
        const parent = Object.assign(new AtomicParent(), { id: 'p1' });
        const child: AtomicCascadeChild = Object.assign(
            new AtomicCascadeChild(),
            { id: 0, parentId: 'p1', parent },
        );
        parent.cascadeChildren = [child];
        db.parents.attach(parent);
        db.cascadeChildren.add(child);
        parent.cascadeChildren = [];
        child.parent = null;
        internalChangeTracker(db.changeTracker).observeDetached(() => {
            throw new Error('detach observer failed');
        });

        expect(() => {
            db.changeTracker.detectChanges();
        }).toThrow('detach observer failed');

        expect(db.entry(child)?.state).toBe(EntityState.Added);
        expect(child.parent).toBeNull();
        expect(parent.cascadeChildren).toEqual([]);
        await db.dispose();
    });

    it('keeps plan-generation finalization inside the detection journal', async () => {
        const db = AtomicRelationshipContext.create();
        const previous = Object.assign(new AtomicParent(), { id: 'p1' });
        const next = Object.assign(new AtomicParent(), { id: 'p2' });
        const child = Object.assign(new AtomicCascadeChild(), {
            id: 1, parentId: 'p1', parent: previous,
        });
        previous.cascadeChildren = [child];
        db.parents.attach(previous);
        db.parents.attach(next);
        db.cascadeChildren.attach(child);
        child.parent = next;
        const primary: unknown = Symbol('generation finalization failed');

        let failure: unknown;
        try {
            internalChangeTracker(db.changeTracker).detectSaveRelationships(
                undefined, undefined, true, undefined, () => {
                    throw primary;
                },
            );
        } catch (error) {
            failure = error;
        }
        expect(failure).toBe(primary);
        expect(child.parentId).toBe('p1');
        expect(child.parent).toBe(next);
        expect(previous.cascadeChildren).toEqual([child]);
        expect(next.cascadeChildren).toEqual([]);
        expect(db.entry(child)?.state).toBe(EntityState.Unchanged);
        await db.dispose();
    });

    it('preserves observer failure and poisons after observer rollback fails', async () => {
        const db = AtomicRelationshipContext.create();
        const parent = Object.assign(new AtomicParent(), { id: 'p1' });
        const first: AtomicCascadeChild = Object.assign(
            new AtomicCascadeChild(), {
                parent, parentId: 'p1',
            });
        const second: AtomicCascadeChild = Object.assign(
            new AtomicCascadeChild(), {
                parent, parentId: 'p1',
            });
        parent.cascadeChildren = [first, second];
        db.parents.attach(parent);
        db.cascadeChildren.add(first);
        db.cascadeChildren.add(second);
        parent.cascadeChildren = [];
        first.parent = null;
        second.parent = null;
        const primary: unknown = Symbol('detach observer failed');
        const cleanup = new Error('detach observer rollback failed');
        let notifications = 0;
        internalChangeTracker(db.changeTracker).observeDetached(() => {
            notifications += 1;
            if (notifications === 2) throw primary;
            return () => {
                throw cleanup;
            };
        });

        let failure: unknown;
        try {
            db.changeTracker.detectChanges();
        } catch (error) {
            failure = error;
        }
        expect(failure).toBe(primary);
        expect(db.entry(first)?.state).toBe(EntityState.Added);
        expect(db.entry(second)?.state).toBe(EntityState.Added);
        let unusable: unknown;
        try {
            await db.parents.count();
        } catch (error) {
            unusable = error;
        }
        expect(unusable).toBeInstanceOf(ContextStateRestorationError);
        expect((unusable as Error).cause).toBe(cleanup);
        await db.dispose();
    });
});
