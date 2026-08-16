import { EntityState } from '../src';
import { requireDefined } from './support/require-defined';
import { rejection } from './support/accessor-refusal-support';
import { trackedIds } from './support/late-attach-load-support';
import {
    NestDependent,
    NestPrincipal,
    openNestedIncludeGraph,
    refuseNavigationWrite,
    storedDependentIds,
    storedJoinRows,
} from './support/late-attach-include-support';
import type { NestedIncludeContext } from './support/late-attach-include-support';

/** Every tracked state, for the "nothing was left changed" assertion. */
function trackedStates(db: NestedIncludeContext): EntityState[] {
    return db.changeTracker.entries().map(entry => entry.state);
}

describe('navigation load participation across include levels', () => {
    it('restores a dependent a later include level failed behind', async () => {
        const db = await openNestedIncludeGraph();
        const principals = await db.principals.orderBy(row => row.id).toArray();
        const first = requireDefined(principals[0]);
        const second = requireDefined(principals[1]);
        const boom = new Error('nested principal refused its second write');
        // The dependents level assigns this collection once; the reference
        // level after it writes the same inverse again and is refused, so the
        // load fails a level later than the one that used the late attach.
        refuseNavigationWrite(second, 'dependents', 2, boom);
        const attached = new NestDependent();
        attached.id = 'd2';
        attached.principalId = 'p2';
        db.onIncludeLevel = (navigationProperty): void => {
            if (navigationProperty !== 'principals') return;
            db.dependents.attach(attached);
        };

        const failure = await rejection(async () => db.owners
            .include(row => row.principals)
            .thenInclude(row => row.dependents)
            .thenInclude(row => row.principal)
            .toArray());

        expect(failure).toBe(boom);
        expect(attached.principal).toBeNull();
        expect(second.dependents).toEqual([]);
        // d1 was this load's own first tracking and is detached; d2 arrived
        // from attach() one level earlier and keeps its tracking and its facts.
        expect(trackedIds(db)).toEqual(['d2', 'o1', 'p1', 'p2']);
        const attachedEntry = requireDefined(db.entry(attached));
        expect(attachedEntry.isNavigationLoaded('principal')).toBe(false);
        expect(attachedEntry.loadedNavigations()).toEqual([]);
        // The principals were touched at two different levels; the earlier
        // capture is the one that describes the graph before the load.
        expect(requireDefined(db.entry(second))
            .isNavigationLoaded('dependents')).toBe(false);
        expect(requireDefined(db.entry(first))
            .isNavigationLoaded('dependents')).toBe(false);

        db.changeTracker.detectChanges();

        expect(trackedStates(db)).toEqual(
            trackedStates(db).map(() => EntityState.Unchanged),
        );
        await expect(db.saveChanges()).resolves.toBe(0);
        await expect(storedDependentIds(db)).resolves.toEqual(['d1', 'd2']);
        await db.dispose();
    });

    it('restores a many-to-many identity hit the stitch then refused', async () => {
        const db = await openNestedIncludeGraph();
        const tag = requireDefined(await db.tags.find('tag1'));
        const boom = new Error('nested tag refused its inverse');
        // The many-to-many level publishes the related side's inverse last, so
        // this refusal lands after the identity hit was stitched and flagged.
        refuseNavigationWrite(tag, 'principals', 1, boom);
        const attached = new NestPrincipal();
        attached.id = 'p2';
        attached.ownerId = 'o1';
        let armed = true;
        // Attached after the level's rows were read and before they are
        // materialized: the identity map, not the load, produces this instance.
        db.onQuery = (sql): void => {
            if (!armed || !sql.includes('"nest_principals"')) return;
            armed = false;
            db.principals.attach(attached);
        };

        const failure = await rejection(async () => db.owners
            .include(row => row.principals)
            .thenInclude(row => row.tags)
            .toArray());

        expect(failure).toBe(boom);
        expect(attached.tags).toEqual([]);
        expect(attached.owner).toBeNull();
        expect(tag.principals).toEqual([]);
        expect(trackedIds(db)).toEqual(['o1', 'p2', 'tag1']);
        const attachedEntry = requireDefined(db.entry(attached));
        expect(attachedEntry.isNavigationLoaded('tags')).toBe(false);
        expect(attachedEntry.isNavigationLoaded('owner')).toBe(false);
        expect(attachedEntry.loadedNavigations()).toEqual([]);
        expect(requireDefined(db.entry(tag)).loadedNavigations()).toEqual([]);

        db.changeTracker.detectChanges();

        expect(trackedStates(db)).toEqual(
            trackedStates(db).map(() => EntityState.Unchanged),
        );
        await expect(db.saveChanges()).resolves.toBe(0);
        await expect(storedJoinRows(db)).resolves
            .toEqual(['p1->tag1', 'p2->tag1']);
        await db.dispose();
    });
});
