import { EntityState } from '../packages/core/src';
import * as copies from '../packages/core/src/tracking/navigation-collection-copy';
import { RefusalDependent, RefusalGraphContext } from './support/accessor-refusal-support';

async function open(count: number): Promise<RefusalGraphContext> {
    const db = RefusalGraphContext.create();
    await db.database.ensureCreated();
    await db.database.connection.query({ text: 'insert into refusal_principals values (\'p1\')', values: [] });
    await db.database.connection.query({
        text: `with recursive numbers(n) as (select 1 union all select n+1 from numbers where n < ?)
            insert into refusal_dependents select 'd' || n, 'p1' from numbers`, values: [count],
    });
    return db;
}

describe('ordinary relationship fixup work', () => {
    afterEach(() => jest.restoreAllMocks());

    it.each([100, 200, 400, 800])('links %i separately loaded children during a no-op save with linear collection work', async count => {
        const db = await open(count);
        try {
            const parent = await db.principals.single();
            const children = await db.dependents.orderBy(row => row.id).toArray();
            let copiedMembers = 0;
            const copy = copies.copyNavigationCollection;
            const collections = jest.spyOn(copies, 'copyNavigationCollection').mockImplementation(value => {
                if (Array.isArray(value)) copiedMembers += value.length;
                return copy(value);
            });
            const queries = jest.spyOn(db.database.connection, 'query');
            await expect(db.saveChanges()).resolves.toBe(0);
            expect(queries).not.toHaveBeenCalled();
            expect(collections.mock.calls.length).toBeLessThanOrEqual(8);
            expect(copiedMembers).toBeLessThanOrEqual(4 * count);
            expect(parent.dependents).toEqual([]);
            expect(children.every(child => child.principal === null)).toBe(true);
            collections.mockClear();
            copiedMembers = 0;
            db.changeTracker.detectChanges();
            expect(collections.mock.calls.length).toBeLessThanOrEqual(8);
            expect(copiedMembers).toBeLessThanOrEqual(4 * count);
            expect(parent.dependents.length).toBe(count);
            expect(parent.dependents).toEqual(children);
            expect(children.every(child => child.principal === parent)).toBe(true);
            expect(db.changeTracker.entries().every(entry => entry.state === EntityState.Unchanged)).toBe(true);
            collections.mockClear();
            await expect(db.saveChanges()).resolves.toBe(0);
            expect(collections).not.toHaveBeenCalled();
            expect(queries).not.toHaveBeenCalled();
        } finally {
            await db.dispose();
        }
    });

    it('retains an untracked inverse addition until attachment resolves its intent', async () => {
        const db = await open(2);
        try {
            const parent = await db.principals.single();
            const children = await db.dependents.toArray();
            const pending = Object.assign(new RefusalDependent(), { id: 'pending' });
            parent.dependents.push(pending);
            await expect(db.saveChanges()).resolves.toBe(0);
            expect(parent.dependents).toEqual([pending]);
            expect(children.every(child => child.principal === null)).toBe(true);
            db.dependents.attach(pending);
            db.changeTracker.detectChanges();
            expect(pending.principal).toBe(parent);
            expect(pending.principalId).toBe(parent.id);
            expect(db.entry(pending)?.state).toBe(EntityState.Modified);
            db.changeTracker.detectChanges();
            expect(new Set(parent.dependents)).toEqual(new Set([pending, ...children]));
        } finally {
            await db.dispose();
        }
    });
});
