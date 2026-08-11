import { EntityState } from '../src';
import { ModelBuilder as ModelBuilderImplementation } from '../src/model/model-builder';
import type { Model } from '../src/model/model';
import { ChangeTracker } from '../src/tracking/change-tracker';
import { configureChangeTrackerModel } from '../src/tracking/change-tracker-model';

class AtomicParent {
    public id = '';
    public children: AtomicChild[] = [];
}

class AtomicChild {
    public id = '';
    public parentId = '';
    public throwNavigation = true;
    private storedParent?: AtomicParent;

    public get parent(): AtomicParent | undefined {
        if (this.throwNavigation) {
            throw new Error('navigation snapshot failed');
        }
        return this.storedParent;
    }

    public set parent(value: AtomicParent | undefined) {
        this.storedParent = value;
    }
}

function atomicModel(): Model {
    return new ModelBuilderImplementation()
        .entity(AtomicParent, entity => {
            entity.toTable('atomic_parents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id)
                .hasColumnType('text').isRequired();
        })
        .entity(AtomicChild, entity => {
            entity.toTable('atomic_children');
            entity.hasKey(row => row.id);
            entity.property(row => row.id)
                .hasColumnType('text').isRequired();
            entity.property(row => row.parentId)
                .hasColumnType('text').isRequired();
            entity.hasOne(AtomicParent, row => row.parent)
                .withMany(parent => parent.children)
                .hasForeignKey(row => row.parentId);
        })
        .build();
}

describe('change tracker registration atomicity', () => {
    it('rolls back every registration index when navigation capture fails', () => {
        const model = atomicModel();
        const metadata = model.getEntity(AtomicChild);
        const tracker = new ChangeTracker();
        configureChangeTrackerModel(tracker, model);
        const child = Object.assign(new AtomicChild(), {
            id: 'child', parentId: 'parent',
        });

        expect(() => tracker.track(
            child,
            metadata,
            EntityState.Unchanged,
        )).toThrow('navigation snapshot failed');
        expect(tracker.entry(child)).toBeUndefined();
        expect(tracker.entries()).toEqual([]);

        child.throwNavigation = false;
        expect(() => tracker.track(
            child,
            metadata,
            EntityState.Unchanged,
        )).not.toThrow();
        expect(tracker.entries()).toHaveLength(1);
    });

    it('rolls back every registration index when a tracked observer fails', () => {
        const model = atomicModel();
        const metadata = model.getEntity(AtomicParent);
        const tracker = new ChangeTracker();
        const parent = Object.assign(new AtomicParent(), { id: 'parent' });
        tracker.observeTracked(() => {
            throw new Error('tracked observer failed');
        });

        expect(() => tracker.track(
            parent,
            metadata,
            EntityState.Unchanged,
        )).toThrow('tracked observer failed');
        expect(tracker.entry(parent)).toBeUndefined();
        expect(tracker.entries()).toEqual([]);

        tracker.observeTracked(() => undefined);
        expect(() => tracker.track(
            parent,
            metadata,
            EntityState.Unchanged,
        )).not.toThrow();
        expect(tracker.entries()).toHaveLength(1);
    });
});
