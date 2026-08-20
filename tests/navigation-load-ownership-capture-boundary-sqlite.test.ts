/**
 * The two edges of the ownership fingerprint: taking one, and what counts in it.
 *
 * The sibling fingerprint suite covers the comparison itself -- what rollback
 * does with a fingerprint it holds. This one covers the boundaries either side.
 * Capture reads the live entity, so it can fail: the registration is recorded
 * before that read, so a capture that throws leaves rollback a registration to
 * refuse rather than tracking nobody recorded. And a difference is only durable
 * work if change detection would call it one, so the store-owned columns it
 * skips are skipped here too.
 */
import { EntityState } from '../packages/core/src';
import { rejection } from './support/accessor-refusal-support';
import { refusal } from './support/link-refusal-support';
import {
    cleanCaptureLoad,
    expectLeakPoison,
    failedCaptureLoad,
    failPausedStampLoad,
    openLeakGraph,
    pauseWithOwnedStampRow,
    resetCaptureRefusal,
    trackedLeakTags,
} from './support/navigation-load-ownership-boundary-support';
import { requireDefined } from './support/require-defined';

describe('a load whose ownership checkpoint cannot be captured', () => {
    afterEach(resetCaptureRefusal);

    it('fails with the accessor refusal, and keeps what it registered', async () => {
        const db = await openLeakGraph();

        // The accessor's own error is still the load's result: a fingerprint
        // that cannot be taken fails the load exactly as one refusing inside
        // `track()` does. What changed is only what rollback inherits.
        expect(((await failedCaptureLoad(db)) as Error).message)
            .toBe('navigation accessor refused');

        // Tracking this load established is still standing -- because rollback
        // refused to take it back, not because it could not find it. A
        // registration with no fingerprint proves nothing about its entry.
        expect(trackedLeakTags(db)).toHaveLength(1);
        await db.dispose();
    });

    it('cannot shadow the database with the entry it kept', async () => {
        const db = await openLeakGraph();
        await failedCaptureLoad(db);

        // What the silent leak used to cost: the database moves on, identity
        // resolution hands the caller the stale instance the failed load
        // materialized, and the query reports success. The refusal is reported
        // instead, so there is no successful query left to be wrong.
        const poison = expectLeakPoison(db);
        expect(await rejection(async () => db.tags.find('tag_1'))).toBe(poison);
        await db.dispose();
    });

    it('refuses every entry point with that one poison', async () => {
        const db = await openLeakGraph();
        await failedCaptureLoad(db);

        const poison = expectLeakPoison(db);
        expect(refusal(() => {
            db.getSavePlanDebugView();
        })).toBe(poison);
        expect(await rejection(async () => db.saveChanges())).toBe(poison);
        expect(refusal(() => {
            db.changeTracker.clear();
        })).toBe(poison);
        await db.dispose();
    });

    it('control: a load that captures cleanly still keeps its own', async () => {
        const db = await openLeakGraph();

        // Unarmed, the same query succeeds and tracks the tag legitimately.
        await cleanCaptureLoad(db);

        expect(trackedLeakTags(db)).toHaveLength(1);
        await db.dispose();
    });
});

describe('a failed load judging a store-generated property', () => {
    it('detaches an entry whose only edit EntityKit calls no change', async () => {
        const run = await pauseWithOwnedStampRow();
        const { db, row } = run;

        // `valueGeneratedOnAddOrUpdate` means the store owns this column: the
        // assignment is left out of `modifiedProperties()`, never lands in an
        // UPDATE, and leaves the entry Unchanged. EntityKit's own verdict is
        // that no durable work exists here, and the fingerprint has to agree.
        row.stamp = 'rewritten-by-user';
        const entry = requireDefined(db.changeTracker.entry(row));
        expect(entry.state).toBe(EntityState.Unchanged);
        expect(entry.modifiedProperties()).toEqual([]);

        await failPausedStampLoad(run);

        expect(db.changeTracker.entry(row)).toBeUndefined();
        await expect(db.saveChanges()).resolves.toBe(0);
        await db.dispose();
    });

    it('detaches when acceptance moved only the generated baseline', async () => {
        const run = await pauseWithOwnedStampRow();
        const { db, row } = run;

        // The same non-work reaching the fingerprint by its other route.
        // Acceptance replaces the baseline object outright, so the pre-image the
        // checkpoint holds stops being the entry's -- but every value the
        // replacement moved is one no INSERT or UPDATE would have carried.
        row.stamp = 'accepted-stamp';
        db.changeTracker.acceptAllChanges();
        expect(requireDefined(db.changeTracker.entry(row)).state)
            .toBe(EntityState.Unchanged);

        await failPausedStampLoad(run);

        expect(db.changeTracker.entry(row)).toBeUndefined();
        await expect(db.saveChanges()).resolves.toBe(0);
        await db.dispose();
    });

    it('control: an untouched generated property still detaches', async () => {
        const run = await pauseWithOwnedStampRow();
        const { db, row } = run;

        await failPausedStampLoad(run);

        expect(db.changeTracker.entry(row)).toBeUndefined();
        await expect(db.saveChanges()).resolves.toBe(0);
        await db.dispose();
    });
});
