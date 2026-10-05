import { EntityState } from '../packages/core/src';
import { NavigationWriteJournal } from '../packages/core/src/tracking/navigation-write-journal';
import * as navigationSnapshots from '../packages/core/src/tracking/navigation-snapshot';
import { RefusalDependent, RefusalGraphContext, RefusalPrincipal } from './support/accessor-refusal-support';

describe('include collection work', () => {
    it.each([250, 500, 1_000])('publishes one inverse collection for %i children', async count => {
        const db = await openGraph(count);
        const writes = jest.spyOn(NavigationWriteJournal.prototype, 'write');
        const snapshots = jest.spyOn(navigationSnapshots, 'captureNavigation');
        const queries = jest.spyOn(db.database.connection, 'query');
        try {
            const children = await db.dependents.include(row => row.principal).toArray();
            const parent = children[0]?.principal;
            expect(parent).toBeInstanceOf(RefusalPrincipal);
            expect(children).toHaveLength(count);
            expect(children.every(child => child.principal === parent)).toBe(true);
            expect(new Set(parent?.dependents)).toEqual(new Set(children));
            expect(queries).toHaveBeenCalledTimes(2);
            const collectionWrites = writes.mock.calls.filter(([entity, property]) =>
                entity === parent && property === 'dependents');
            expect(collectionWrites).toHaveLength(1);
            expect(collectionWrites.reduce((total, [, , value]) =>
                total + (Array.isArray(value) ? value.length : 0), 0)).toBe(count);
            expect(snapshots.mock.calls.filter(([entry, property]) =>
                entry.entity === parent && property === 'dependents')).toHaveLength(2);
            db.changeTracker.detectChanges();
            expect(db.changeTracker.entries().every(entry =>
                entry.state === EntityState.Unchanged)).toBe(true);
        } finally {
            jest.restoreAllMocks();
            await db.dispose();
        }
    });

    it('stitches a large collection with unique child identities and one publication', async () => {
        const db = await openGraph(1_000);
        const writes = jest.spyOn(NavigationWriteJournal.prototype, 'write');
        try {
            const parent = await db.principals.include(row => row.dependents).single();
            expect(parent.dependents).toHaveLength(1_000);
            expect(new Set(parent.dependents).size).toBe(1_000);
            expect(parent.dependents.every(child => child.principal === parent)).toBe(true);
            expect(writes.mock.calls.filter(([entity, property]) =>
                entity === parent && property === 'dependents')).toHaveLength(1);
        } finally {
            jest.restoreAllMocks();
            await db.dispose();
        }
    });

    it('rolls back every child when the completed inverse collection is refused', async () => {
        const db = await openGraph(250);
        try {
            const parent = await db.principals.single();
            const kept = await db.dependents.where(row => row.id.eq('d1')).single();
            Object.defineProperty(parent, 'dependents', {
                configurable: true, get: () => [], set: () => undefined,
            });
            await expect(db.dependents.include(row => row.principal).toArray())
                .rejects.toThrow('refused its assigned value');
            expect(kept.principal).toBeNull();
            expect(parent.dependents).toEqual([]);
            // Root rows are materialized before the include operation begins;
            // failed stitching restores their graph and leaves them tracked.
            expect(db.changeTracker.entries()).toHaveLength(251);
            expect(db.changeTracker.entries().filter(entry =>
                entry.entity instanceof RefusalDependent).every(entry =>
                (entry.entity as RefusalDependent).principal === null)).toBe(true);
            expect(db.entry(kept)?.isNavigationLoaded('principal')).toBe(false);
            expect(db.changeTracker.entries().every(entry =>
                entry.state === EntityState.Unchanged)).toBe(true);
            await expect(db.dependents.count()).resolves.toBe(250);
        } finally {
            await db.dispose();
        }
    });
});

async function openGraph(count: number): Promise<RefusalGraphContext> {
    const db = RefusalGraphContext.create();
    await db.database.ensureCreated();
    await db.database.connection.query({
        text: 'insert into refusal_principals (id) values (\'p1\')', values: [],
    });
    await db.database.connection.query({
        text: `with recursive numbers(n) as (
            select 1 union all select n + 1 from numbers where n < ?
        ) insert into refusal_dependents (id, principal_id)
        select 'd' || n, 'p1' from numbers`, values: [count],
    });
    return db;
}
