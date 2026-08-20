import { ContextStateRestorationError } from '../../packages/core/src';
import { refusalMessage, rejection } from './accessor-refusal-support';
import { refusal } from './link-refusal-support';
import {
    insertRaceJoinRow,
    openRaceGraph,
} from './navigation-supersession-support';
import type {
    RaceContext,
    RaceNote,
    RacePost,
    RaceTag,
} from './navigation-supersession-support';
import { requireDefined } from './require-defined';

/** A nested include held open after it materialized and stitched a tag. */
export interface PausedOwnedTag {
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
 * The held statement is the tag's own many-to-many level, which queries the join
 * table before writing anything, so `tag.posts` is a navigation this load has
 * neither written nor flagged -- the write journal's supersession guard has
 * nothing to say about it, and neither does the participation checkpoint.
 */
export async function pauseWithOwnedTag(
    seedJoin = false,
): Promise<PausedOwnedTag> {
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
export async function failPausedLoad(run: PausedOwnedTag): Promise<void> {
    const boom = new Error('nested join query refused');
    run.db.connection.failPaused(boom);
    expect(await rejection(async () => run.loading)).toBe(boom);
}

/** The refusal ownership rollback reports once the entry moved on. */
export function ownershipRefusal(entityName: string): string {
    return `Entity '${entityName}' changed while its load was in progress; ` +
        'rollback cannot safely detach it.';
}

/** Assert the context reports the standard poisoned-state failure. */
export function expectPoison(failure: unknown): ContextStateRestorationError {
    expect(failure).toBeInstanceOf(ContextStateRestorationError);
    expect(failure).toMatchObject({
        name: 'ContextStateRestorationError',
        code: 'CONTEXT_STATE_RESTORATION_FAILED',
    });
    return failure as ContextStateRestorationError;
}

/** Every individual cleanup failure the poison carries, in rollback order. */
export function restorationCauses(
    poison: ContextStateRestorationError,
): string[] {
    const cause: unknown = poison.cause;
    return cause instanceof AggregateError
        ? (cause.errors as unknown[]).map(error => refusalMessage(error))
        : [refusalMessage(cause)];
}

/** The poison a refused ownership detach left behind, and nothing else. */
export function expectDetachPoison(
    db: RaceContext,
): ContextStateRestorationError {
    const poison = expectPoison(refusal(() => {
        db.getSavePlan();
    }));
    expect(restorationCauses(poison)).toEqual([ownershipRefusal('RaceTag')]);
    return poison;
}

/** Read the tag table straight off the connection a poisoned context refuses. */
export async function storedTagNames(db: RaceContext): Promise<string[]> {
    const result = await db.connection.query<{ name: string }>({
        text: 'select name from race_tags order by id',
        values: [],
    });
    return result.rows.map(row => row.name);
}
