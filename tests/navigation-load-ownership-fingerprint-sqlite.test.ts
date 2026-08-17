/**
 * Ownership rollback judged by fingerprint rather than by entry state.
 *
 * The sibling supersession suite covers work whose *state* announces itself: a
 * `remove()`, a detected modification, a queued `link()`. This one covers the
 * work that does not. EntityKit never requires `detectChanges()` after an edit,
 * so a plain assignment leaves the entry Unchanged until something asks, and an
 * accepted edit puts it back to Unchanged for good. "Unchanged because nobody
 * touched it" and "Unchanged because the newer work was already accepted" are
 * the same value, so state cannot be what authorises a silent detach.
 */
import { EntityState } from '../src';
import {
    expectDetachPoison,
    expectPoison,
    failPausedLoad,
    ownershipRefusal,
    pauseWithOwnedTag,
    restorationCauses,
    storedTagNames,
} from './support/navigation-load-ownership-support';
import { refusal } from './support/link-refusal-support';
import { StrongId } from './support/converter-fact-support';
import {
    failPausedMarkLoad,
    pauseWithOwnedMarkTag,
    storedMarkCodes,
} from './support/navigation-load-fingerprint-support';
import type { MarkContext } from './support/navigation-load-fingerprint-support';
import { requireDefined } from './support/require-defined';

/** Replace one property with a getter no fingerprint read can survive. */
function makeUnreadable(target: object, property: string): void {
    Object.defineProperty(target, property, {
        configurable: true,
        enumerable: true,
        get: () => {
            throw new Error('hostile accessor');
        },
    });
}

describe('a failed load detaching only what it can prove is still its own', () => {
    it('keeps a scalar edit no detection pass has looked at yet', async () => {
        const run = await pauseWithOwnedTag();
        const { db, tag } = run;

        // The supported shape of an EntityKit edit: assign, save later. No
        // detection has run, so the entry the load registered is still exactly
        // as Unchanged as an entity nobody touched.
        tag.name = 'undetected';
        expect(requireDefined(db.changeTracker.entry(tag)).state)
            .toBe(EntityState.Unchanged);

        await failPausedLoad(run);

        // Detaching here is what silently discarded the write: the save plan
        // came back empty, saveChanges() reported 0, and the live object kept
        // claiming a name the database had never heard of.
        expect(db.changeTracker.entry(tag)).toBeDefined();
        expect(tag.name).toBe('undetected');
        expectDetachPoison(db);
        await expect(storedTagNames(db))
            .resolves.toEqual(['TypeScript', 'Postgres']);
        await db.dispose();
    });

    it('keeps an edit that acceptAllChanges() returned to Unchanged', async () => {
        const run = await pauseWithOwnedTag();
        const { db, tag } = run;

        tag.name = 'accepted-edit';
        db.changeTracker.detectChanges();
        db.changeTracker.acceptAllChanges();
        // Back to the state the load registered, by a completely different
        // route: the edit is now the entry's own baseline.
        expect(requireDefined(db.changeTracker.entry(tag)).state)
            .toBe(EntityState.Unchanged);

        await failPausedLoad(run);

        expect(db.changeTracker.entry(tag)).toBeDefined();
        expect(tag.name).toBe('accepted-edit');
        expectDetachPoison(db);
        await db.dispose();
    });

    it('keeps an edit to a navigation this load never wrote', async () => {
        const run = await pauseWithOwnedTag();
        const { db, post, tag } = run;

        // The held statement is the join-table read for `tag.posts`, which
        // queries before it writes, so this collection is not in the graph
        // journal and not in any participation checkpoint either.
        tag.posts = [post];

        await failPausedLoad(run);

        expect(db.changeTracker.entry(tag)).toBeDefined();
        expect(tag.posts.map(row => row.id)).toEqual(['post_1']);
        expectDetachPoison(db);
        await db.dispose();
    });

    it('keeps an entry whose fingerprint cannot be read at all', async () => {
        const run = await pauseWithOwnedTag();
        const { db, tag } = run;

        makeUnreadable(tag, 'name');

        await failPausedLoad(run);

        // An unreadable entry is not a matching one. The load's own failure
        // still comes back first, and the refusal is reported rather than
        // resolved by guessing in rollback's favour.
        expect(db.changeTracker.entry(tag)).toBeDefined();
        expectDetachPoison(db);
        await db.dispose();
    });

    it('still detaches an entity the failed load alone ever touched', async () => {
        const run = await pauseWithOwnedTag();
        const { db, note, tag } = run;

        await failPausedLoad(run);

        // The control. Every fact the load moved on this tag was handed back by
        // the graph journal and the participation checkpoints before ownership
        // compared anything, so the entry matches its own capture exactly.
        expect(db.changeTracker.entry(tag)).toBeUndefined();
        expect(note.tag).toBeNull();
        expect(db.getSavePlanDebugView()).not.toContain('RaceTag');
        await expect(db.saveChanges()).resolves.toBe(0);
        await expect(db.notes.count()).resolves.toBe(1);
        await db.dispose();
    });

    it('detaches an entity whose every changed fact was put back', async () => {
        const run = await pauseWithOwnedTag();
        const { db, post, tag } = run;

        tag.name = 'briefly-renamed';
        tag.posts = [post];
        tag.name = 'TypeScript';
        // A different array object holding the same entities in the same order
        // is what an unwound journal write hands back, so it has to compare
        // equal here too or no rollback could ever complete.
        tag.posts = [];

        await failPausedLoad(run);

        expect(db.changeTracker.entry(tag)).toBeUndefined();
        expect(run.note.tag).toBeNull();
        await expect(db.saveChanges()).resolves.toBe(0);
        await db.dispose();
    });
});

/** The poison a refused detach of the converter-backed tag left behind. */
function expectMarkDetachPoison(db: MarkContext): void {
    const poison = expectPoison(refusal(() => {
        db.getSavePlan();
    }));
    expect(restorationCauses(poison)).toEqual([ownershipRefusal('MarkTag')]);
}

describe('a failed load fingerprinting values only a converter can read', () => {
    it('keeps a private-field value object replaced mid-load', async () => {
        const run = await pauseWithOwnedMarkTag();
        const { db, tag } = run;

        // Two StrongIds are structurally identical -- their whole state is a
        // `#value` -- so only a converter-aware comparison sees this edit.
        tag.code = new StrongId('rewritten');
        expect(requireDefined(db.changeTracker.entry(tag)).state)
            .toBe(EntityState.Unchanged);

        await failPausedMarkLoad(run);

        expect(db.changeTracker.entry(tag)).toBeDefined();
        expect(tag.code.value).toBe('rewritten');
        expectMarkDetachPoison(db);
        await expect(storedMarkCodes(db)).resolves.toEqual(['ts']);
        await db.dispose();
    });

    it('keeps an entry whose converter refuses the value it now holds', async () => {
        const run = await pauseWithOwnedMarkTag();
        const { db, tag } = run;

        // `toProvider` throws for anything that is not a StrongId, so reading
        // this fingerprint fails rather than reporting a difference.
        tag.code = 'plain-string' as unknown as StrongId;

        await failPausedMarkLoad(run);

        expect(db.changeTracker.entry(tag)).toBeDefined();
        expectMarkDetachPoison(db);
        await db.dispose();
    });

    it('still detaches the converter-backed tag nothing else touched', async () => {
        const run = await pauseWithOwnedMarkTag();
        const { db, note, tag } = run;

        await failPausedMarkLoad(run);

        expect(db.changeTracker.entry(tag)).toBeUndefined();
        expect(note.tag).toBeNull();
        await expect(db.saveChanges()).resolves.toBe(0);
        await db.dispose();
    });
});
