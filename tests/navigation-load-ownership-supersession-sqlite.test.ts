/**
 * The ownership-side mirror of `navigation-load-supersession-sqlite`.
 *
 * That suite proves a failed load refuses to overwrite a *navigation* a newer
 * public operation replaced. This one asks the same question about the other
 * half of the load's rollback -- the entries it registered itself -- and about
 * the durable work a public operation established against them: whose entry is
 * standing under the entity now, and what a detach would take away with it.
 */
import { ContextStateRestorationError, EntityState } from '../src';
import { refusalMessage, rejection } from './support/accessor-refusal-support';
import { refusal } from './support/link-refusal-support';
import {
    insertRaceJoinRow,
    openRaceGraph,
    storedRaceJoinRows,
} from './support/navigation-supersession-support';
import type {
    RaceContext,
    RaceNote,
    RacePost,
    RaceTag,
} from './support/navigation-supersession-support';
import { requireDefined } from './support/require-defined';

interface PausedOwnedTag {
    readonly db: RaceContext;
    readonly note: RaceNote;
    readonly post: RacePost;
    /** A tag THIS load was the first to track. */
    readonly tag: RaceTag;
    readonly loading: Promise<unknown>;
}

/**
 * Stitch `note.tag` with a tag the load materialized, then hold the query below.
 *
 * The tag is deliberately not pre-fetched: the load is the first to track it, so
 * the tracker journal records that entry as owned and a failed load detaches it.
 * The held statement is the tag's own many-to-many level, so `tag.posts` is a
 * navigation this load has *not* written -- the write journal's supersession
 * guard has nothing to say about it.
 */
async function pauseWithOwnedTag(seedJoin = false): Promise<PausedOwnedTag> {
    const db = await openRaceGraph();
    if (seedJoin) await insertRaceJoinRow(db, 'post_1', 'tag_1');
    const note = requireDefined(await db.notes.find('note_1'));
    const post = requireDefined(await db.posts.find('post_1'));
    const reached = db.connection.pauseOn('race_post_tags');
    const loading = db.notes
        .include(row => row.tag)
        .thenInclude(row => row.posts)
        .toArray();
    await reached;
    const tag = requireDefined(note.tag, 'stitched tag');
    return { db, note, post, tag, loading };
}

/** Release the held statement, and prove the load's own error stays primary. */
async function failPausedLoad(run: PausedOwnedTag): Promise<void> {
    const boom = new Error('nested join query refused');
    run.db.connection.failPaused(boom);
    expect(await rejection(async () => run.loading)).toBe(boom);
}

/** The refusal ownership rollback reports once the entry moved on. */
function ownershipRefusal(entityName: string): string {
    return `Entity '${entityName}' changed while its load was in progress; ` +
        'rollback cannot safely detach it.';
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
function restorationCauses(poison: ContextStateRestorationError): string[] {
    const cause: unknown = poison.cause;
    return cause instanceof AggregateError
        ? (cause.errors as unknown[]).map(error => refusalMessage(error))
        : [refusalMessage(cause)];
}

/** The poison a refused ownership detach left behind, and nothing else. */
function expectDetachPoison(run: PausedOwnedTag): ContextStateRestorationError {
    const poison = expectPoison(refusal(() => {
        run.db.getSavePlan();
    }));
    expect(restorationCauses(poison)).toEqual([ownershipRefusal('RaceTag')]);
    return poison;
}

/** Read the tag table straight off the connection a poisoned context refuses. */
async function storedTagNames(db: RaceContext): Promise<string[]> {
    const result = await db.connection.query<{ name: string }>({
        text: 'select name from race_tags order by id',
        values: [],
    });
    return result.rows.map(row => row.name);
}

describe('a failed load unwinding tracking it no longer owns', () => {
    it('keeps an attach() that re-established tracking mid-load', async () => {
        const run = await pauseWithOwnedTag();
        const { db, tag } = run;
        const owned = requireDefined(db.changeTracker.entry(tag));

        // The load's tracking is taken away and the caller establishes its own.
        db.changeTracker.detach(tag);
        db.tags.attach(tag);
        tag.name = 'renamed-by-user';
        expect(db.changeTracker.entry(tag)).not.toBe(owned);
        expect(db.getSavePlanDebugView()).toContain('Modified');

        await failPausedLoad(run);

        // The entry the load created is long gone; the one standing here came
        // from a public attach() and is not the load's to take back. A distinct
        // entry is proof rather than ambiguity, so nothing is poisoned either.
        expect(db.changeTracker.entry(tag)).toBeDefined();
        expect(db.getSavePlanDebugView()).toContain('Modified');
        await expect(db.saveChanges()).resolves.toBe(1);
        await expect(storedTagNames(db))
            .resolves.toEqual(['renamed-by-user', 'Postgres']);
        await db.dispose();
    });

    it('does not silently drop a link() queued against an owned entity', async () => {
        const run = await pauseWithOwnedTag();
        const { db, post, tag } = run;

        db.link(post, row => row.tags, tag);
        expect(post.tags.map(row => row.id)).toEqual(['tag_1']);
        expect(db.getSavePlanDebugView()).toContain('post_1->tag_1');

        await failPausedLoad(run);

        // Detaching the tag would cancel the queued insert, but the collection
        // the link() published is not the load's to roll back, so the graph
        // would still claim a link no save will ever write. The detach fails
        // closed instead: the tag stays tracked, the queue stays queued, and
        // the ambiguity is reported rather than resolved.
        expect(db.changeTracker.entry(tag)).toBeDefined();
        expect(post.tags.map(row => row.id)).toEqual(['tag_1']);
        expectDetachPoison(run);
        expect(await storedRaceJoinRows(db)).toEqual([]);
        await db.dispose();
    });

    it('does not silently drop an unlink() queued against an owned entity', async () => {
        const run = await pauseWithOwnedTag(true);
        const { db, post, tag } = run;
        db.link(post, row => row.tags, tag);
        db.changeTracker.acceptAllChanges();
        expect(post.tags.map(row => row.id)).toEqual(['tag_1']);

        db.unlink(post, row => row.tags, tag);
        expect(post.tags).toEqual([]);
        expect(db.getSavePlanDebugView()).toContain('post_1->tag_1');

        await failPausedLoad(run);

        // The mirror of the link case. Detaching would leave the row in the
        // join table forever while the graph says it is gone; the row is still
        // there either way, but now the context says so.
        expect(await storedRaceJoinRows(db)).toEqual(['post_1->tag_1']);
        expectDetachPoison(run);
        await db.dispose();
    });

    it('does not silently drop a remove() of an owned entity', async () => {
        const run = await pauseWithOwnedTag();
        const { db, tag } = run;

        db.tags.remove(tag);
        expect(requireDefined(db.changeTracker.entry(tag)).state)
            .toBe(EntityState.Deleted);

        await failPausedLoad(run);

        // A detach would erase the pending delete as quietly as it erases a
        // queued join row: the entry left the load's state, so it is no longer
        // the load's to take back.
        expect(requireDefined(db.changeTracker.entry(tag)).state)
            .toBe(EntityState.Deleted);
        expectDetachPoison(run);
        await expect(storedTagNames(db))
            .resolves.toEqual(['TypeScript', 'Postgres']);
        await db.dispose();
    });

    it('does not silently drop a detected change to an owned entity', async () => {
        const run = await pauseWithOwnedTag();
        const { db, tag } = run;

        tag.name = 'renamed-mid-load';
        db.changeTracker.detectChanges();
        expect(requireDefined(db.changeTracker.entry(tag)).state)
            .toBe(EntityState.Modified);

        await failPausedLoad(run);

        // The load registered this entry Unchanged; it is Modified now, and
        // the update it carries is exactly what a detach would throw away.
        expect(requireDefined(db.changeTracker.entry(tag)).state)
            .toBe(EntityState.Modified);
        expect(tag.name).toBe('renamed-mid-load');
        expectDetachPoison(run);
        await expect(storedTagNames(db))
            .resolves.toEqual(['TypeScript', 'Postgres']);
        await db.dispose();
    });

    it('refuses every entry point with the one refused-detach poison', async () => {
        const run = await pauseWithOwnedTag();
        const { db, post, tag } = run;
        db.link(post, row => row.tags, tag);

        await failPausedLoad(run);

        const poison = expectDetachPoison(run);
        expect(refusal(() => {
            db.getSavePlanDebugView();
        })).toBe(poison);
        expect(await rejection(async () => db.notes.find('note_1')))
            .toBe(poison);
        expect(await rejection(async () => db.saveChanges())).toBe(poison);
        expect(refusal(() => {
            db.changeTracker.clear();
        })).toBe(poison);
        expect(refusal(() => {
            db.unlink(post, row => row.tags, tag);
        })).toBe(poison);
        await db.dispose();
    });

    it('still detaches an owned entity nothing else claimed', async () => {
        const run = await pauseWithOwnedTag();
        const { db, tag } = run;

        await failPausedLoad(run);

        // The unchanged half of the contract: ownership rollback still works.
        expect(db.changeTracker.entry(tag)).toBeUndefined();
        expect(run.note.tag).toBeNull();
        await expect(db.notes.count()).resolves.toBe(1);
        await expect(db.saveChanges()).resolves.toBe(0);
        await db.dispose();
    });

    it('leaves an add() that landed mid-load alone', async () => {
        const run = await pauseWithOwnedTag();
        const { db } = run;
        const fresh: RaceTag = {
            id: 'tag_9', name: 'new', posts: [], notes: [],
        };
        db.tags.add(fresh);

        await failPausedLoad(run);

        expect(db.changeTracker.entry(fresh)).toBeDefined();
        expect(db.getSavePlanDebugView()).toContain('tag_9');
        await expect(db.saveChanges()).resolves.toBe(1);
        await db.dispose();
    });

    it('leaves a replacement instance attached under the same key alone', async () => {
        const run = await pauseWithOwnedTag();
        const { db, tag } = run;
        db.changeTracker.detach(tag);
        const replacement: RaceTag = {
            id: 'tag_1', name: 'replacement', posts: [], notes: [],
        };
        db.tags.attach(replacement);

        await failPausedLoad(run);

        expect(db.changeTracker.entry(replacement)).toBeDefined();
        expect(db.changeTracker.entry(tag)).toBeUndefined();
        await expect(db.saveChanges()).resolves.toBe(0);
        await db.dispose();
    });
});
