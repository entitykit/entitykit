import { ContextStateRestorationError } from '../packages/core/src';
import {
    refusalMessage,
    rejection,
} from './support/accessor-refusal-support';
import { refusal } from './support/link-refusal-support';
import type {
    PausedRaceLoad,
    RacePost,
} from './support/navigation-supersession-support';
import {
    pauseAfterTagReferenceStitch,
    pauseAfterTagStitch,
    storedRaceJoinRows,
} from './support/navigation-supersession-support';

/** The refusal a journaled write reports once it no longer owns its value. */
function supersession(entityName: string, property: string): string {
    return `Navigation '${entityName}.${property}' changed while its load ` +
        'was in progress; rollback cannot safely overwrite the newer value.';
}

/** Assert the context reports the standard poisoned-state failure. */
function expectPoison(failure: unknown): ContextStateRestorationError {
    expect(failure).toBeInstanceOf(ContextStateRestorationError);
    expect(failure).toMatchObject({
        name: 'ContextStateRestorationError',
        code: 'CONTEXT_STATE_RESTORATION_FAILED',
    });
    return failure as ContextStateRestorationError;
}

/** Every individual cleanup failure the poison carries, in rollback order. */
function restorationCauses(
    poison: ContextStateRestorationError,
): string[] {
    const cause: unknown = poison.cause;
    return cause instanceof AggregateError
        ? (cause.errors as unknown[]).map(error => refusalMessage(error))
        : [refusalMessage(cause)];
}

/** Every public entry point a poisoned context must refuse identically. */
async function expectPoisonedEverywhere(
    run: PausedRaceLoad<RacePost>,
    poison: ContextStateRestorationError,
): Promise<void> {
    expect(refusal(() => {
        run.db.getSavePlan();
    })).toBe(poison);
    expect(refusal(() => {
        run.db.getSavePlanDebugView();
    })).toBe(poison);
    expect(await rejection(async () => run.db.posts.find('post_1')))
        .toBe(poison);
    expect(await rejection(async () => run.db.saveChanges())).toBe(poison);
    expect(refusal(() => {
        run.db.changeTracker.clear();
    })).toBe(poison);
    expect(refusal(() => {
        run.db.link(run.entity, row => row.tags, run.second);
    })).toBe(poison);
}

describe('a navigation load that no longer owns what it wrote', () => {
    it('rolls the stitched collection back when nothing superseded it', async () => {
        const run = await pauseAfterTagStitch();
        const post = run.entity;
        expect(post.tags.map(row => row.id)).toEqual(['tag_1']);
        const boom = new Error('nested note query refused');

        run.db.connection.failPaused(boom);

        expect(await rejection(async () => run.loading)).toBe(boom);
        // Nobody raced this load, so the pre-load value is still the load's to
        // hand back and the guard has to stay out of the way entirely.
        expect(post.tags).toEqual([]);
        await expect(run.db.posts.count()).resolves.toBe(1);
        await expect(run.db.saveChanges()).resolves.toBe(0);
        await run.db.dispose();
    });

    it('keeps a link that landed while the nested include was in flight', async () => {
        const run = await pauseAfterTagStitch();
        const post = run.entity;
        expect(post.tags.map(row => row.id)).toEqual(['tag_1']);

        run.db.link(post, row => row.tags, run.second);

        expect(post.tags.map(row => row.id)).toEqual(['tag_1', 'tag_2']);
        expect(post.tags[1]).toBe(run.second);
        expect(run.db.getSavePlanDebugView()).toContain('post_1->tag_2');
        expect(await storedRaceJoinRows(run.db)).toEqual(['post_1->tag_1']);
        const boom = new Error('nested note query refused');

        run.db.connection.failPaused(boom);

        expect(await rejection(async () => run.loading)).toBe(boom);
        // The rollback owns `[tag_1]`; `link()` published `[tag_1, tag_2]`
        // after it, so the newer collection is the one that stands.
        expect(post.tags.map(row => row.id)).toEqual(['tag_1', 'tag_2']);
        expect(post.tags[1]).toBe(run.second);
        const poison = expectPoison(
            await rejection(async () => run.db.posts.count()),
        );
        expect(poison).not.toBe(boom);
        expect(restorationCauses(poison)).toEqual([
            supersession('RacePost', 'tags'),
        ]);
        await expectPoisonedEverywhere(run, poison);
        // The queued insert can never run through a context whose graph and
        // whose pending plan no longer agree.
        expect(await storedRaceJoinRows(run.db)).toEqual(['post_1->tag_1']);
        await run.db.dispose();
    });

    it('keeps an unlink that landed while the nested include was in flight', async () => {
        const run = await pauseAfterTagStitch(true);
        const post = run.entity;
        expect(post.tags.map(row => row.id)).toEqual(['tag_1']);

        run.db.unlink(post, row => row.tags, run.first);

        expect(post.tags).toEqual([]);
        expect(run.db.getSavePlanDebugView()).toContain('post_1->tag_1');
        expect(await storedRaceJoinRows(run.db)).toEqual(['post_1->tag_1']);
        const boom = new Error('nested note query refused');

        run.db.connection.failPaused(boom);

        expect(await rejection(async () => run.loading)).toBe(boom);
        // The mirror of the link case: the load would put `tag_1` back, but
        // `unlink()` already took it out on purpose.
        expect(post.tags).toEqual([]);
        const poison = expectPoison(
            await rejection(async () => run.db.posts.count()),
        );
        expect(poison).not.toBe(boom);
        expect(restorationCauses(poison)).toEqual([
            supersession('RacePost', 'tags'),
        ]);
        await expectPoisonedEverywhere(run, poison);
        // The queued deletion never runs, so the row the graph no longer shows
        // is still exactly where it was.
        expect(await storedRaceJoinRows(run.db)).toEqual(['post_1->tag_1']);
        await run.db.dispose();
    });

    it('keeps an accepted reference move the nested load raced', async () => {
        const run = await pauseAfterTagReferenceStitch();
        const note = run.entity;
        expect(note.tag).toBe(run.first);

        note.tag = run.second;
        note.tagId = 'tag_2';
        run.db.changeTracker.detectChanges();
        run.db.changeTracker.acceptAllChanges();
        const boom = new Error('nested join query refused');

        run.db.connection.failPaused(boom);

        expect(await rejection(async () => run.loading)).toBe(boom);
        // Neither reinstalled to `tag_1` nor nulled out: an accepted move is a
        // committed fact, and the reference and its key stay agreeing.
        expect(note.tag).toBe(run.second);
        expect(note.tagId).toBe('tag_2');
        expect(run.first.notes).toEqual([]);
        expect(run.second.notes.map(row => row.id)).toEqual(['note_1']);
        const poison = expectPoison(
            await rejection(async () => run.db.notes.count()),
        );
        expect(poison).not.toBe(boom);
        // Every phase still ran: the inverse collection the load stitched, and
        // then the reference itself, each refusing on its own account.
        expect(restorationCauses(poison)).toEqual([
            supersession('RaceTag', 'notes'),
            supersession('RaceNote', 'tag'),
        ]);
        expect(refusal(() => {
            run.db.getSavePlan();
        })).toBe(poison);
        expect(await rejection(async () => run.db.saveChanges())).toBe(poison);
        expect(refusal(() => {
            run.db.changeTracker.clear();
        })).toBe(poison);
        await run.db.dispose();
    });
});
