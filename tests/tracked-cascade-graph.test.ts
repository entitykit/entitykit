import { DeleteBehavior, EntityState } from '../packages/core/src';
import { TrackedCascadeGraph } from '../packages/core/src/tracking/tracked-cascade-graph';
import { captureRelationshipDetectionValues } from '../packages/core/src/tracking/relationship-detection-values';
import * as resolution from '../packages/core/src/tracking/relationship-resolution';
import { contextModel, internalChangeTracker, internalEntityEntry } from './support/public-api-internals';
import { createRelationshipDb, RequiredPost, User } from './support/relationship-model';
import type { EntityEntry } from '../packages/core/src/tracking/entity-entry';
import { ChangeTracker } from '../packages/core/src/tracking/change-tracker';
import { ModelBuilder as InternalModelBuilder } from '../packages/core/src/model/model-builder';
import { detectTrackedCascades } from '../packages/core/src/tracking/relationship-delete-detector';
import * as graphModule from '../packages/core/src/tracking/tracked-cascade-graph';

class PendingParent {
    public id = 0; public children: PendingChild[] = [];
}
class PendingChild {
    public id = ''; public parentId = 0; public parent: PendingParent | null = null;
}

describe('tracked cascade adjacency', () => {
    afterEach(() => jest.restoreAllMocks());

    it('resolves FK-only dependents once per principal type and leaves missing or unrelated targets alone', () => {
        const db = createRelationshipDb();
        const one = new User({ id: 'one', cascadePosts: [] });
        const two = new User({ id: 'two', cascadePosts: [] });
        const principal = internalEntityEntry(db.users.attach(one)) as unknown as EntityEntry<object>;
        const other = internalEntityEntry(db.users.attach(two)) as unknown as EntityEntry<object>;
        const first = new RequiredPost({ id: 'first', title: 'first', authorId: one.id, author: null });
        const second = new RequiredPost({ id: 'second', title: 'second', authorId: one.id, author: null });
        const missing = new RequiredPost({ id: 'missing', title: 'missing', authorId: 'absent', author: null });
        const detached = new RequiredPost({ id: 'detached', title: 'detached', authorId: one.id, author: one });
        db.requiredPosts.attach(first); db.requiredPosts.attach(second); db.requiredPosts.attach(missing);
        const detachedEntry = internalEntityEntry(db.requiredPosts.attach(detached)) as unknown as EntityEntry<object>;
        db.requiredPosts.detach(detached);
        const tracker = internalChangeTracker(db.changeTracker);
        const entries = [...tracker.entries(), detachedEntry];
        const captured = captureRelationshipDetectionValues(entries);
        const graph = new TrackedCascadeGraph(tracker, contextModel(db), entries, captured);
        const resolved = jest.spyOn(resolution, 'findTrackedPrincipal');
        expect(graph.dependentsOf(principal).map(edge => edge.dependent.entity)).toEqual([first, second]);
        expect(graph.dependentsOf(other)).toEqual([]);
        expect(graph.dependentsOf(principal)).toHaveLength(2);
        expect(resolved).toHaveBeenCalledTimes(3);
        const post = tracker.entry(first);
        if (!post) throw new Error('missing fixture entry');
        expect(graph.dependentsOf(post as unknown as EntityEntry<object>)).toEqual([]);
    });

    it('ignores initially deleted and subsequently deleted or detached dependents', () => {
        const db = createRelationshipDb();
        const parent = new User({ id: 'parent' });
        const principal = internalEntityEntry(db.users.attach(parent)) as unknown as EntityEntry<object>;
        const posts = ['before', 'deleted', 'detached'].map(id => new RequiredPost({ id, authorId: parent.id, author: parent }));
        for (const post of posts) db.requiredPosts.attach(post);
        db.requiredPosts.remove(posts[0]);
        const tracker = internalChangeTracker(db.changeTracker);
        const entries = tracker.entries();
        const graph = new TrackedCascadeGraph(tracker, contextModel(db), entries, captureRelationshipDetectionValues(entries));
        db.requiredPosts.remove(posts[1]);
        db.requiredPosts.detach(posts[2]);
        expect(graph.dependentsOf(principal)).toEqual([]);
        expect(db.entry(posts[0])?.state).toBe(EntityState.Deleted);
    });

    it('falls back to the captured FK when a navigation is untracked, primitive, or a different mapped type', () => {
        const db = createRelationshipDb();
        const parent = new User({ id: 'parent' });
        const principal = internalEntityEntry(db.users.attach(parent)) as unknown as EntityEntry<object>;
        const different = new RequiredPost({ id: 'different', authorId: 'absent', author: null });
        db.requiredPosts.attach(different);
        const posts = [new User({ id: parent.id }), 'primitive', different].map((author, index) =>
            Object.assign(new RequiredPost({ id: String(index), authorId: parent.id }), { author }));
        for (const post of posts) db.requiredPosts.attach(post);
        const tracker = internalChangeTracker(db.changeTracker);
        const entries = tracker.entries();
        const entry = tracker.entry.bind(tracker);
        jest.spyOn(tracker, 'entry').mockImplementation(entity => {
            expect(typeof entity).toBe('object');
            expect(entity).not.toBeNull();
            return entry(entity);
        });
        const graph = new TrackedCascadeGraph(tracker, contextModel(db), entries, captureRelationshipDetectionValues(entries));
        expect(graph.dependentsOf(principal).map(edge => edge.dependent.entity)).toEqual(posts);
    });
    it('honors explicit unresolved generated-key intent instead of guessing from the FK', () => {
        const model = new InternalModelBuilder().entity(PendingParent, entity => {
            entity.toTable('pending_parents'); entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired().valueGeneratedOnAdd();
        }).entity(PendingChild, entity => {
            entity.toTable('pending_children'); entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.parentId).hasColumnType('integer').isRequired();
            entity.hasOne(PendingParent, row => row.parent).withMany(row => row.children)
                .hasForeignKey(row => row.parentId).onDelete(DeleteBehavior.Cascade);
        }).build();
        const parent = new PendingParent();
        const child = Object.assign(new PendingChild(), { id: 'child', parent });
        const tracker = new ChangeTracker();
        const principal = tracker.track(parent, model.getEntity(PendingParent), EntityState.Added) as unknown as EntityEntry<object>;
        tracker.track(child, model.getEntity(PendingChild), EntityState.Added);
        const entries = tracker.entries();
        const graph = new TrackedCascadeGraph(tracker, model, entries, captureRelationshipDetectionValues(entries));
        expect(graph.dependentsOf(principal).map(edge => edge.dependent.entity)).toEqual([child]);
    });

    it('does no cascade graph preparation when no tracked entity is deleted', () => {
        const db = createRelationshipDb();
        const parent = new User({ id: 'parent' });
        db.users.attach(parent);
        db.requiredPosts.attach(new RequiredPost({ id: 'child', authorId: parent.id, author: parent }));
        const tracker = internalChangeTracker(db.changeTracker);
        const Graph = graphModule.TrackedCascadeGraph;
        const preparation = jest.spyOn(graphModule, 'TrackedCascadeGraph').mockImplementation((...args) => new Graph(...args));
        detectTrackedCascades(tracker, contextModel(db), captureRelationshipDetectionValues(tracker.entries()));
        expect(preparation).not.toHaveBeenCalled();
    });
});
