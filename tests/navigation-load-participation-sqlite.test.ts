import { ContextStateRestorationError, EntityState } from '../packages/core/src';
import { requireDefined } from './support/require-defined';
import { refusalMessage, rejection } from './support/accessor-refusal-support';
import {
    loadDependentsWithLateAttach,
    loadHolderWithLateAttach,
    postStitchRefusal,
    storedBadgeIds,
    storedDependentIds,
    trackedIds,
} from './support/late-attach-load-support';

/** Assert the context reports the standard poisoned-state failure. */
function expectPoison(failure: unknown): ContextStateRestorationError {
    expect(failure).toBeInstanceOf(ContextStateRestorationError);
    expect(failure).toMatchObject({
        name: 'ContextStateRestorationError',
        code: 'CONTEXT_STATE_RESTORATION_FAILED',
    });
    return failure as ContextStateRestorationError;
}

describe('navigation load participation of late-attached entities', () => {
    it('restores a dependent attached while the collection load ran', async () => {
        const calibration = await loadDependentsWithLateAttach();
        await calibration.db.dispose();

        const { db, owner, attached, failure } =
            await loadDependentsWithLateAttach({
                refuseReadAt: calibration.reads,
            });

        expect(refusalMessage(failure)).toBe(postStitchRefusal);
        expect(owner.dependents).toEqual([]);
        expect(attached.principal).toBeNull();
        // The load owned d2 and merely used d1: one is detached, the other is
        // handed back its own facts rather than the failed load's.
        expect(trackedIds(db)).toEqual(['d1', 'p1']);
        const attachedEntry = requireDefined(db.entry(attached));
        expect(attachedEntry.isNavigationLoaded('principal')).toBe(false);
        expect(attachedEntry.loadedNavigations()).toEqual([]);
        expect(requireDefined(db.entry(owner))
            .isNavigationLoaded('dependents')).toBe(false);

        db.changeTracker.detectChanges();

        // A stale baseline would read back as a severed required reference and
        // cascade the row away on the next unrelated save.
        expect(attachedEntry.state).toBe(EntityState.Unchanged);
        await expect(db.saveChanges()).resolves.toBe(0);
        await expect(storedDependentIds(db)).resolves
            .toEqual(['d1', 'd2', 'd3']);
        await db.dispose();
    });

    it('restores a principal attached while the reference load ran', async () => {
        const calibration = await loadHolderWithLateAttach();
        await calibration.db.dispose();

        const { db, owner, attached, failure } =
            await loadHolderWithLateAttach(calibration.reads);

        expect(refusalMessage(failure)).toBe(postStitchRefusal);
        expect(owner.holder).toBeNull();
        // The inverse the fixup stitched belongs to a principal the load never
        // tracked: its flag and its baseline are still the load's to hand back.
        expect(attached.badge).toBeNull();
        expect(trackedIds(db)).toEqual(['b1', 'h1']);
        const attachedEntry = requireDefined(db.entry(attached));
        expect(attachedEntry.isNavigationLoaded('badge')).toBe(false);
        expect(attachedEntry.loadedNavigations()).toEqual([]);
        expect(requireDefined(db.entry(owner))
            .isNavigationLoaded('holder')).toBe(false);

        db.changeTracker.detectChanges();

        expect(attachedEntry.state).toBe(EntityState.Unchanged);
        expect(requireDefined(db.entry(owner)).state)
            .toBe(EntityState.Unchanged);
        await expect(db.saveChanges()).resolves.toBe(0);
        await expect(storedBadgeIds(db)).resolves.toEqual(['b1', 'b2']);
        await db.dispose();
    });

    it('poisons the context when a late participant refuses its rollback', async () => {
        const calibration = await loadDependentsWithLateAttach();
        await calibration.db.dispose();
        const primary = new Error(postStitchRefusal);
        const restorationBoom = new Error('late dependent refused its rollback');

        const { db, owner, attached, failure } =
            await loadDependentsWithLateAttach({
                refuseReadAt: calibration.reads,
                refuseReadWith: primary,
                refuseRestoration: restorationBoom,
            });

        // The load's own failure stays primary; the refusal that could not be
        // undone is reported as the poison every later operation reports.
        expect(failure).toBe(primary);
        expect(attached.principal).toBe(owner);
        // A restoration that cannot finish is not an excuse to skip the rest of
        // it: the participant still gets the facts it had before the load.
        const attachedEntry = requireDefined(db.entry(attached));
        expect(attachedEntry.isNavigationLoaded('principal')).toBe(false);
        expect(attachedEntry.loadedNavigations()).toEqual([]);
        const poison = expectPoison(
            await rejection(async () => db.principals.count()),
        );
        expect(poison).not.toBe(failure);
        expect(poison.cause).toBe(restorationBoom);
        expect(await rejection(async () => db.dependents.count())).toBe(poison);
        expect(await rejection(async () => db.saveChanges())).toBe(poison);
        await db.dispose();
    });
});
