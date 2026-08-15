import { EntityState } from '../src';
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
    repointStoredPrincipal,
    trackedRefusalGraph,
} from './support/accessor-refusal-support';

const writeLog: string[] = [];

function interceptForeignKey(
    dependent: RefusalDependent,
    refused: string | null,
): void {
    let stored = dependent.principalId;
    Object.defineProperty(dependent, 'principalId', {
        configurable: true,
        enumerable: true,
        get: () => stored,
        set: (value: string) => {
            writeLog.push(`principalId=${value}`);
            if (value === refused) return;
            stored = value;
        },
    });
}

function interceptReference(
    dependent: RefusalDependent,
    refused: RefusalPrincipal,
): void {
    let stored = dependent.principal;
    Object.defineProperty(dependent, 'principal', {
        configurable: true,
        enumerable: true,
        get: () => stored,
        set: (value: RefusalPrincipal | null) => {
            writeLog.push(`principal=${value?.id ?? 'null'}`);
            if (value === refused) return;
            stored = value;
        },
    });
}

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

async function loadedPrincipals(
    db: RefusalGraphContext,
): Promise<RefusalPrincipal[]> {
    return db.principals.orderBy(row => row.id)
        .include(row => row.dependents).toArray();
}

/** A setter that keeps untracked copies rather than the assigned instances. */
function cloningStore(value: RefusalDependent[]): RefusalDependent[] {
    return value.map(row => Object.assign(
        new (row.constructor as new () => RefusalDependent)(), row,
    ));
}

/** Identities the context still tracks, for detach assertions. */
function trackedIds(db: RefusalGraphContext): string[] {
    return db.changeTracker.entries()
        .map(entry => (entry.entity as { id: string }).id).sort();
}

describe('accessor refusal across relationship fix-up', () => {
    beforeEach(() => {
        writeLog.length = 0;
    });

    it('fails a reload whose reference navigation refuses the new principal', async () => {
        const { db, first, second, dependent } = await trackedRefusalGraph();
        const entry = requireDefined(db.entry(dependent));
        await repointStoredPrincipal(db, 'd1', 'p2');
        interceptReference(dependent, second);
        writeLog.length = 0;

        const failure = await rejection(async () => entry.reload());

        expect(refusalMessage(failure)).toBe(
            'Navigation \'RefusalDependent.principal\' refused its assigned value.',
        );
        expect(dependent.principalId).toBe('p1');
        expect(dependent.principal).toBe(first);
        expect(first.dependents).toEqual([dependent]);
        expect(second.dependents).toEqual([]);
        expect(entry.state).toBe(EntityState.Unchanged);
        expect(entry.originalValues).toEqual({ id: 'd1', principalId: 'p1' });
        expect(entry.modifiedProperties()).toEqual([]);
        expect(writeLog).toContain('principal=p2');
        await expect(db.dependents.count()).resolves.toBe(3);
        await db.dispose();
    });

    it('fails detection whose foreign key refuses the reassigned principal', async () => {
        const { db, first, second, dependent } = await trackedRefusalGraph();
        const entry = requireDefined(db.entry(dependent));
        interceptForeignKey(dependent, 'p2');
        interceptCollection(first, value => value);
        interceptCollection(second, value => value);
        dependent.principal = second;
        writeLog.length = 0;

        const failure = await rejection(() => {
            db.changeTracker.detectChanges();
        });

        expect(refusalMessage(failure)).toBe(
            'Property \'RefusalDependent.principalId\' refused its assigned value.',
        );
        expect(dependent.principalId).toBe('p1');
        expect(first.dependents).toEqual([dependent]);
        expect(second.dependents).toEqual([]);
        expect(entry.state).toBe(EntityState.Unchanged);
        expect(entry.originalValues).toEqual({ id: 'd1', principalId: 'p1' });
        expect(entry.modifiedProperties()).toEqual([]);
        expect(dependent.principal).toBe(second);
        expect(writeLog).toEqual([
            'dependents(p1)=',
            'principalId=p2',
            'dependents(p1)=d1',
            'dependents(p2)=',
            'principalId=p1',
        ]);
        await expect(db.dependents.count()).resolves.toBe(3);
        await db.dispose();
    });

    it('unwinds an include collection whose setter stores cloned elements', async () => {
        const db = await openRefusalGraph();
        const second = requireDefined(await db.principals.find('p2'));
        interceptCollection(second, cloningStore);

        const failure = await rejection(async () => loadedPrincipals(db));

        expect(refusalMessage(failure)).toBe(
            'Navigation \'RefusalPrincipal.dependents\' refused its assigned value.',
        );
        expect(requireDefined(db.entry(second))
            .isNavigationLoaded('dependents')).toBe(false);
        expect(writeLog).toEqual(['dependents(p2)=d2,d3', 'dependents(p2)=']);
        expect(second.dependents).toEqual([]);
        expect(trackedIds(db)).toEqual(['p1', 'p2']);
        await expect(db.principals.count()).resolves.toBe(2);
        await db.dispose();
    });

    it('unwinds an include collection whose setter reorders the elements', async () => {
        const db = await openRefusalGraph();
        const second = requireDefined(await db.principals.find('p2'));
        interceptCollection(second, value => [...value].reverse());

        const failure = await rejection(async () => loadedPrincipals(db));

        expect(refusalMessage(failure)).toBe(
            'Navigation \'RefusalPrincipal.dependents\' refused its assigned value.',
        );
        expect(requireDefined(db.entry(second))
            .isNavigationLoaded('dependents')).toBe(false);
        expect(second.dependents).toEqual([]);
        expect(trackedIds(db)).toEqual(['p1', 'p2']);
        await expect(db.principals.count()).resolves.toBe(2);
        await db.dispose();
    });

    it('poisons the context when the include restoration is refused too', async () => {
        const db = await openRefusalGraph();
        const second = requireDefined(await db.principals.find('p2'));
        let remembered: RefusalDependent[] | undefined;
        interceptCollection(second, value => {
            remembered ??= value.length > 0 ? cloningStore(value) : undefined;
            return remembered ?? value;
        });

        const failure = await rejection(async () => loadedPrincipals(db));

        expect(refusalMessage(failure)).toBe(
            'Navigation \'RefusalPrincipal.dependents\' refused its assigned value.',
        );
        expect(writeLog).toEqual(['dependents(p2)=d2,d3', 'dependents(p2)=']);
        expect(second.dependents.map(row => row.id)).toEqual(['d2', 'd3']);
        const unusable = await rejection(async () => db.principals.count());
        expect(unusable).toMatchObject({
            name: 'ContextStateRestorationError',
            code: 'CONTEXT_STATE_RESTORATION_FAILED',
        });
        expect(refusalMessage((unusable as Error).cause)).toBe(
            'Navigation \'RefusalPrincipal.dependents\' refused its restoration value.',
        );
        await db.dispose();
    });

    it('accepts an include collection stored in another array of the same items', async () => {
        const db = await openRefusalGraph();
        const second = requireDefined(await db.principals.find('p2'));
        const assigned: RefusalDependent[][] = [];
        interceptCollection(second, value => {
            assigned.push(value);
            return [...value];
        });

        const principals = await loadedPrincipals(db);

        expect(principals.map(row => row.id)).toEqual(['p1', 'p2']);
        expect(second.dependents.map(row => row.id)).toEqual(['d2', 'd3']);
        expect(second.dependents).not.toBe(assigned.at(-1));
        expect(second.dependents).toEqual(assigned.at(-1));
        expect(requireDefined(db.entry(second))
            .isNavigationLoaded('dependents')).toBe(true);
        await db.dispose();
    });
});
