import { EntityState } from '../src';
import { requireDefined } from './support/require-defined';
import type {
    RefusalDependent,
    RefusalPrincipal,
} from './support/accessor-refusal-support';
import {
    openRefusalGraph,
    refusalMessage,
    rejection,
} from './support/accessor-refusal-support';

const writeLog: string[] = [];

/** Replace the inverse collection with a setter that keeps what it likes. */
function interceptCollection(
    principal: RefusalPrincipal,
    store: (value: RefusalDependent[]) => RefusalDependent[],
): void {
    let stored = principal.dependents;
    Object.defineProperty(principal, 'dependents', {
        configurable: true,
        enumerable: true,
        get: () => stored,
        set: (value: RefusalDependent[]) => {
            writeLog.push(`dependents(${principal.id})=${
                value.map(row => row.id).join(',')}`);
            stored = store(value);
        },
    });
}

describe('navigation load atomicity', () => {
    beforeEach(() => {
        writeLog.length = 0;
    });

    it('restores both sides when a reference load inverse refuses', async () => {
        const db = await openRefusalGraph();
        const first = requireDefined(await db.principals.find('p1'));
        const dependent = requireDefined(await db.dependents.find('d1'));
        interceptCollection(first, () => []);
        const entry = requireDefined(db.entry(dependent));

        const failure = await rejection(async () =>
            entry.reference(row => row.principal).load());

        expect(refusalMessage(failure)).toBe(
            'Navigation \'RefusalPrincipal.dependents\' refused its assigned value.',
        );
        expect(dependent.principal).toBeNull();
        expect(first.dependents).toEqual([]);
        expect(entry.isNavigationLoaded('principal')).toBe(false);
        expect(requireDefined(db.entry(first))
            .isNavigationLoaded('dependents')).toBe(false);
        expect(entry.state).toBe(EntityState.Unchanged);
        expect(entry.modifiedProperties()).toEqual([]);
        expect(writeLog).toEqual(['dependents(p1)=d1', 'dependents(p1)=']);
        await expect(db.principals.count()).resolves.toBe(2);
        await db.dispose();
    });

    it('leaves no phantom relationship change behind a failed include', async () => {
        const db = await openRefusalGraph();
        const first = requireDefined(await db.principals.find('p1'));
        const second = requireDefined(await db.principals.find('p2'));
        const kept = requireDefined(await db.dependents.find('d1'));
        interceptCollection(second, () => []);

        await rejection(async () => db.principals
            .orderBy(row => row.id).include(row => row.dependents).toArray());
        db.changeTracker.detectChanges();

        // The unwind restores navigation baselines as well as values: a stale
        // baseline reads back as a severed relationship the user never made.
        expect(kept.principalId).toBe('p1');
        expect(kept.principal).toBe(first);
        expect(first.dependents).toEqual([kept]);
        expect(second.dependents).toEqual([]);
        expect(db.changeTracker.entries().every(
            row => row.state === EntityState.Unchanged,
        )).toBe(true);
        await db.dispose();
    });

    it('restores a collection load whose principal refuses the dependents', async () => {
        const db = await openRefusalGraph();
        const second = requireDefined(await db.principals.find('p2'));
        interceptCollection(second, () => []);
        const entry = requireDefined(db.entry(second));

        const failure = await rejection(async () =>
            entry.collection(row => row.dependents).load());

        expect(refusalMessage(failure)).toBe(
            'Navigation \'RefusalPrincipal.dependents\' refused its assigned value.',
        );
        expect(second.dependents).toEqual([]);
        expect(entry.isNavigationLoaded('dependents')).toBe(false);
        expect(db.changeTracker.entries().map(row => row.state)).toEqual([
            EntityState.Unchanged,
        ]);
        await expect(db.dependents.count()).resolves.toBe(3);
        await db.dispose();
    });

    it('unwinds a failed include across every root it already stitched', async () => {
        const db = await openRefusalGraph();
        const second = requireDefined(await db.principals.find('p2'));
        interceptCollection(second, () => []);

        const failure = await rejection(async () => db.principals
            .orderBy(row => row.id).include(row => row.dependents).toArray());

        expect(refusalMessage(failure)).toBe(
            'Navigation \'RefusalPrincipal.dependents\' refused its assigned value.',
        );
        const first = requireDefined(await db.principals.find('p1'));
        expect(first.dependents).toEqual([]);
        expect(second.dependents).toEqual([]);
        expect(requireDefined(db.entry(first))
            .isNavigationLoaded('dependents')).toBe(false);
        expect(writeLog).toEqual(['dependents(p2)=d2,d3', 'dependents(p2)=']);
        await db.dispose();
    });

    it('detaches only the entities the failed include first tracked', async () => {
        const db = await openRefusalGraph();
        const second = requireDefined(await db.principals.find('p2'));
        const kept = requireDefined(await db.dependents.find('d2'));
        interceptCollection(second, () => []);

        await rejection(async () => db.principals
            .orderBy(row => row.id).include(row => row.dependents).toArray());

        expect(db.changeTracker.entries().map(row =>
            (row.entity as { id: string }).id).sort()).toEqual([
            'd2', 'p1', 'p2',
        ]);
        expect(kept.principal).toBeNull();
        expect(requireDefined(db.entry(kept)).state)
            .toBe(EntityState.Unchanged);
        await expect(db.principals.count()).resolves.toBe(2);
        await db.dispose();
    });
});
