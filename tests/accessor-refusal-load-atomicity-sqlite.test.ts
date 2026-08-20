import { EntityState } from '../packages/core/src';
import { requireDefined } from './support/require-defined';
import type {
    RefusalDependent,
    RefusalGraphContext,
    RefusalPrincipal,
} from './support/accessor-refusal-support';
import {
    openRefusalGraph,
    refusalMessage,
    rejection,
} from './support/accessor-refusal-support';

/** An untracked copy of a loaded entity, as a hostile setter would keep. */
function cloneOf<TEntity extends object>(row: TEntity): TEntity {
    return Object.assign(new (row.constructor as new () => TEntity)(), row);
}

/** Identities the context still tracks, for detach assertions. */
function trackedIds(db: RefusalGraphContext): string[] {
    return db.changeTracker.entries()
        .map(entry => (entry.entity as { id: string }).id).sort();
}

describe('accessor refusal across explicit and eager navigation loads', () => {
    it('restores the split graph and lets the load be retried', async () => {
        const db = await openRefusalGraph();
        const first = requireDefined(await db.principals.find('p1'));
        const dependent = requireDefined(await db.dependents.find('d1'));
        const untouched = first.dependents;
        let refuse = true;
        let stored = first.dependents;
        Object.defineProperty(first, 'dependents', {
            configurable: true,
            enumerable: true,
            get: () => stored,
            set: (value: RefusalDependent[]) => {
                if (refuse) return;
                stored = value;
            },
        });
        const entry = requireDefined(db.entry(dependent));
        const principalEntry = requireDefined(db.entry(first));

        const failure = await rejection(async () =>
            entry.reference(row => row.principal).load());

        expect(refusalMessage(failure)).toBe(
            'Navigation \'RefusalPrincipal.dependents\' refused its assigned value.',
        );
        expect(dependent.principal).toBeNull();
        expect(first.dependents).toBe(untouched);
        expect(first.dependents).toEqual([]);
        expect(entry.isNavigationLoaded('principal')).toBe(false);
        expect(principalEntry.isNavigationLoaded('dependents')).toBe(false);
        expect(entry.state).toBe(EntityState.Unchanged);
        expect(principalEntry.state).toBe(EntityState.Unchanged);
        expect(entry.modifiedProperties()).toEqual([]);
        expect(entry.originalValues).toEqual({ id: 'd1', principalId: 'p1' });
        expect(trackedIds(db)).toEqual(['d1', 'p1']);
        await expect(db.principals.count()).resolves.toBe(2);

        refuse = false;
        await entry.reference(row => row.principal).load();

        expect(dependent.principal).toBe(first);
        expect(first.dependents).toEqual([dependent]);
        expect(entry.isNavigationLoaded('principal')).toBe(true);
        expect(entry.state).toBe(EntityState.Unchanged);
        await db.dispose();
    });

    it('unwinds every dependent an include assigned before the setter threw', async () => {
        const db = await openRefusalGraph();
        const second = requireDefined(await db.principals.find('p2'));
        const tracked = requireDefined(await db.dependents.find('d2'));
        const boom = new Error('dependents setter exploded');
        let assigned: RefusalDependent[] = [];
        let calls = 0;
        let stored: RefusalDependent[] = second.dependents;
        Object.defineProperty(second, 'dependents', {
            configurable: true,
            enumerable: true,
            get: () => stored,
            set: (value: RefusalDependent[]) => {
                calls += 1;
                if (calls > 1) {
                    stored = value;
                    return;
                }
                assigned = [...value];
                // Store one dependent, then abandon the assignment mid-write.
                stored = value.slice(0, 1);
                throw boom;
            },
        });

        const failure = await rejection(async () => db.principals
            .orderBy(row => row.id).include(row => row.dependents).toArray());

        expect(failure).toBe(boom);
        expect(assigned.map(row => row.id)).toEqual(['d2', 'd3']);
        expect(assigned[0]).toBe(tracked);
        const detached = requireDefined(assigned[1]);
        expect(second.dependents).toEqual([]);
        expect(tracked.principal).toBeNull();
        expect(detached.principal).toBeNull();
        expect(requireDefined(db.entry(second))
            .isNavigationLoaded('dependents')).toBe(false);
        expect(requireDefined(db.entry(tracked))
            .isNavigationLoaded('principal')).toBe(false);
        expect(requireDefined(db.entry(second)).state)
            .toBe(EntityState.Unchanged);
        expect(requireDefined(db.entry(tracked)).state)
            .toBe(EntityState.Unchanged);
        // The include was the first to track d3, so the unwind detaches it;
        // d2 was already tracked, so it is restored in place instead.
        expect(db.entry(detached)).toBeUndefined();
        expect(trackedIds(db)).toEqual(['d2', 'p1', 'p2']);
        const first = requireDefined(await db.principals.find('p1'));
        expect(first.dependents).toEqual([]);
        expect(requireDefined(db.entry(first))
            .isNavigationLoaded('dependents')).toBe(false);
        await expect(db.principals.count()).resolves.toBe(2);
        await expect(db.dependents.count()).resolves.toBe(3);
        await db.dispose();
    });

    it('leaves no untracked clone live when a reference load is substituted', async () => {
        const db = await openRefusalGraph();
        const first = requireDefined(await db.principals.find('p1'));
        const dependent = requireDefined(await db.dependents.find('d1'));
        const entry = requireDefined(db.entry(dependent));
        const clones: RefusalPrincipal[] = [];
        let stored = dependent.principal;
        Object.defineProperty(dependent, 'principal', {
            configurable: true,
            enumerable: true,
            get: () => stored,
            set: (value: RefusalPrincipal | null) => {
                if (!value) {
                    stored = value;
                    return;
                }
                const clone = cloneOf(value);
                clones.push(clone);
                stored = clone;
            },
        });

        const failure = await rejection(async () =>
            entry.reference(row => row.principal).load());

        expect(refusalMessage(failure)).toBe(
            'Navigation \'RefusalDependent.principal\' refused its assigned value.',
        );
        expect(clones).toHaveLength(1);
        expect(dependent.principal).toBeNull();
        expect(clones.every(clone => db.entry(clone) === undefined)).toBe(true);
        expect(first.dependents).toEqual([]);
        expect(entry.isNavigationLoaded('principal')).toBe(false);
        expect(requireDefined(db.entry(first))
            .isNavigationLoaded('dependents')).toBe(false);
        expect(entry.state).toBe(EntityState.Unchanged);
        expect(entry.originalValues).toEqual({ id: 'd1', principalId: 'p1' });
        expect(trackedIds(db)).toEqual(['d1', 'p1']);
        await expect(db.principals.count()).resolves.toBe(2);
        await db.dispose();
    });

    it('leaves no untracked clone live when a collection load is substituted', async () => {
        const db = await openRefusalGraph();
        const second = requireDefined(await db.principals.find('p2'));
        const entry = requireDefined(db.entry(second));
        const clones: RefusalDependent[] = [];
        let stored = second.dependents;
        Object.defineProperty(second, 'dependents', {
            configurable: true,
            enumerable: true,
            get: () => stored,
            set: (value: RefusalDependent[]) => {
                const copies = value.map(row => cloneOf(row));
                clones.push(...copies);
                stored = copies;
            },
        });

        const failure = await rejection(async () =>
            entry.collection(row => row.dependents).load());

        expect(refusalMessage(failure)).toBe(
            'Navigation \'RefusalPrincipal.dependents\' refused its assigned value.',
        );
        expect(clones).toHaveLength(2);
        expect(second.dependents).toEqual([]);
        expect(clones.every(clone => db.entry(clone) === undefined)).toBe(true);
        expect(entry.isNavigationLoaded('dependents')).toBe(false);
        expect(entry.state).toBe(EntityState.Unchanged);
        expect(trackedIds(db)).toEqual(['p2']);
        await expect(db.dependents.count()).resolves.toBe(3);
        await db.dispose();
    });
});
