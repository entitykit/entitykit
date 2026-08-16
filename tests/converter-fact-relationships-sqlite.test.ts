import { EntityState } from '../src';
import { requireDefined } from './support/require-defined';
import { refusalMessage, rejection } from './support/accessor-refusal-support';
import type { FactChild, FactGraph } from './support/converter-fact-support';
import {
    FactParent,
    StrongId,
    interceptProperty,
    storedParentId,
    trackedFactGraph,
} from './support/converter-fact-support';

/** The killer setter: a structurally identical value object for the old key. */
function retainPrincipal(child: FactChild, retained: string): void {
    interceptProperty<StrongId>(child, 'parentId', value =>
        value.value === retained ? value : new StrongId(retained));
}

/** Assert every fact about a refused move agrees on the original principal. */
async function expectPointsAtPrevious(graph: FactGraph): Promise<void> {
    const { db, previous, next, child } = graph;
    const entry = requireDefined(db.entry(child));
    expect(child.parentId).toBeInstanceOf(StrongId);
    expect(child.parentId.value).toBe('p1');
    expect(previous.children).toContain(child);
    expect(next.children).not.toContain(child);
    expect(entry.originalValues.parentId).toBeInstanceOf(StrongId);
    expect((entry.originalValues.parentId as StrongId).value).toBe('p1');
    expect(entry.state).toBe(EntityState.Unchanged);
    expect(entry.modifiedProperties()).toEqual([]);
    await expect(storedParentId(db, 'c1')).resolves.toBe('p1');
}

/** The save plan must never come back empty while the graph is divergent. */
function expectNoEmptyPlan(graph: FactGraph, message: string): void {
    expect(() => graph.db.getSavePlan()).toThrow(message);
}

const refusedForeignKey =
    'Property \'FactChild.parentId\' refused its assigned value.';
const refusedOwnerKey =
    'Property \'FactProfile.ownerId\' refused its assigned value.';

describe('converter-aware relationship fix-up of private-field keys', () => {
    it('fails a navigation move whose foreign key setter retains the old id', async () => {
        const graph = await trackedFactGraph();
        const { db, next, child } = graph;
        retainPrincipal(child, 'p1');
        child.parent = next;

        const failure = await rejection(() => {
            db.changeTracker.detectChanges();
        });

        expect(refusalMessage(failure)).toBe(refusedForeignKey);
        await expectPointsAtPrevious(graph);
        expectNoEmptyPlan(graph, refusedForeignKey);
        await expect(db.children.count()).resolves.toBe(2);
        await db.dispose();
    });

    it('leaves a foreign-key-only move the setter dropped fully consistent', async () => {
        const graph = await trackedFactGraph();
        const { db, child } = graph;
        retainPrincipal(child, 'p1');
        // The caller's own assignment never lands, so nothing diverges and the
        // empty save plan is the honest answer rather than a silent write.
        child.parentId = new StrongId('p2');

        expect(child.parentId.value).toBe('p1');
        expect(db.getSavePlan()).toEqual([]);
        await expect(db.saveChanges()).resolves.toBe(0);

        expect(child.parent).toBe(graph.previous);
        await expectPointsAtPrevious(graph);
        await expect(db.children.count()).resolves.toBe(2);
        await db.dispose();
    });

    it('fails a one-to-one move whose owner key setter retains the old id', async () => {
        const graph = await trackedFactGraph();
        const { db, previous, next, profile } = graph;
        interceptProperty<StrongId>(profile, 'ownerId', value =>
            value.value === 'p1' ? value : new StrongId('p1'));
        profile.owner = next;

        const failure = await rejection(() => {
            db.changeTracker.detectChanges();
        });

        expect(refusalMessage(failure)).toBe(refusedOwnerKey);
        const entry = requireDefined(db.entry(profile));
        expect(profile.ownerId).toBeInstanceOf(StrongId);
        expect(profile.ownerId.value).toBe('p1');
        expect(previous.profile).toBe(profile);
        expect(next.profile).toBeNull();
        expect((entry.originalValues.ownerId as StrongId).value).toBe('p1');
        expect(entry.state).toBe(EntityState.Unchanged);
        expect(entry.modifiedProperties()).toEqual([]);
        expect(() => db.getSavePlan()).toThrow(refusedOwnerKey);
        await db.dispose();
    });

    it('fails a many-to-one move made through both inverse collections', async () => {
        const graph = await trackedFactGraph();
        const { db, previous, next, child } = graph;
        retainPrincipal(child, 'p1');
        previous.children = previous.children.filter(row => row !== child);
        next.children = [...next.children, child];

        const failure = await rejection(() => {
            db.changeTracker.detectChanges();
        });

        expect(refusalMessage(failure)).toBe(refusedForeignKey);
        const entry = requireDefined(db.entry(child));
        expect(child.parentId).toBeInstanceOf(StrongId);
        expect(child.parentId.value).toBe('p1');
        expect(child.parent).toBe(previous);
        expect((entry.originalValues.parentId as StrongId).value).toBe('p1');
        expect(entry.state).toBe(EntityState.Unchanged);
        expect(entry.modifiedProperties()).toEqual([]);
        await expect(storedParentId(db, 'c1')).resolves.toBe('p1');
        // Restoration returns the collections to the caller's own pre-detection
        // state, so the still-pending intent must keep refusing a save plan.
        expect(previous.children).toEqual([]);
        expect(next.children.map(row => row.id)).toEqual(['c2', 'c1']);
        expectNoEmptyPlan(graph, refusedForeignKey);
        await db.dispose();
    });

    it('accepts a navigation move whose setter rebuilds an equal identifier', async () => {
        const graph = await trackedFactGraph();
        const { db, previous, next, child } = graph;
        interceptProperty<StrongId>(child, 'parentId', value =>
            new StrongId(value.value));
        child.parent = next;

        db.changeTracker.detectChanges();
        await expect(db.saveChanges()).resolves.toBe(1);

        const entry = requireDefined(db.entry(child));
        expect(child.parentId).toBeInstanceOf(StrongId);
        expect(child.parentId.value).toBe('p2');
        expect(next.children).toContain(child);
        expect(previous.children).not.toContain(child);
        expect(entry.originalValues.parentId).toBeInstanceOf(StrongId);
        expect((entry.originalValues.parentId as StrongId).value).toBe('p2');
        expect(entry.state).toBe(EntityState.Unchanged);
        await expect(storedParentId(db, 'c1')).resolves.toBe('p2');
        expect(db.getSavePlan()).toEqual([]);
        await db.dispose();
    });

    it('keeps a refused move out of the database on a later save attempt', async () => {
        const graph = await trackedFactGraph();
        const { db, next, child } = graph;
        retainPrincipal(child, 'p1');
        child.parent = next;

        await rejection(() => {
            db.changeTracker.detectChanges();
        });
        const second = await rejection(async () => db.saveChanges());

        expect(refusalMessage(second)).toBe(refusedForeignKey);
        await expectPointsAtPrevious(graph);
        const parents = await db.parents.orderBy(row => row.id).toArray();
        expect(parents.map(row => row.id.value)).toEqual(['p1', 'p2']);
        expect(parents[0]).toBeInstanceOf(FactParent);
        await db.dispose();
    });
});
