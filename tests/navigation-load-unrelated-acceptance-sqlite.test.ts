import { EntityState } from '../packages/core/src';
import { requireDefined } from './support/require-defined';
import { refusalMessage, rejection } from './support/accessor-refusal-support';
import type {
    LateAttachContext,
    LateBadge,
    LateHolder,
} from './support/late-attach-load-support';
import {
    openLateAttachGraph,
    storedBadgeIds,
    trackedIds,
} from './support/late-attach-load-support';

/** Take the dependent table away so the next collection load fails for real. */
async function dropDependentsTable(db: LateAttachContext): Promise<void> {
    for (const text of [
        'pragma foreign_keys = OFF',
        'drop table late_dependents',
        'pragma foreign_keys = ON',
    ]) {
        await db.database.connection.query({ text, values: [] });
    }
}

/** An accepted relationship move, and the unrelated load still failing behind it. */
interface AcceptedMove {
    readonly db: LateAttachContext;
    /** The dependent whose reference and foreign key the move re-pointed. */
    readonly badge: LateBadge;
    readonly previous: LateHolder;
    readonly next: LateHolder;
    /** The unrelated collection load, in flight across the whole move. */
    readonly loading: Promise<unknown>;
}

/**
 * Move a loaded badge between holders while an unrelated load is pending.
 *
 * The badge and both holders carry loaded flags and navigation baselines before
 * the load begins, so a load that captured tracker facts from tracker
 * membership rather than from its own participation would hold a checkpoint of
 * every one of them. The move, its detection, and its acceptance are one
 * synchronous run: the load cannot settle part-way through it, and the accepted
 * result is the tracker's committed truth by the time the load is allowed to
 * fail. The context permits exactly this -- synchronous tracker work while a
 * load is pending -- and an unrelated failure may not reach back into it.
 */
async function acceptMoveWhileLoadPending(): Promise<AcceptedMove> {
    const db = await openLateAttachGraph();
    const badge = requireDefined(await db.badges.find('b1'));
    await requireDefined(db.entry(badge)).reference(row => row.holder).load();
    const previous = requireDefined(badge.holder);
    const next = requireDefined(await db.holders.find('h2'));
    const principal = requireDefined(await db.principals.find('p1'));
    await dropDependentsTable(db);

    const loading = requireDefined(db.entry(principal))
        .collection(row => row.dependents).load();
    badge.holder = next;
    previous.badge = null;
    next.badge = badge;
    db.changeTracker.detectChanges();
    db.changeTracker.acceptAllChanges();
    return { db, badge, previous, next, loading };
}

/** Replace one property with an observer that reports every write it is asked for. */
function interceptWrites(
    owner: object,
    property: string,
    onWrite: () => void,
): void {
    let stored: unknown = (owner as Record<string, unknown>)[property];
    Object.defineProperty(owner, property, {
        configurable: true,
        enumerable: true,
        get: (): unknown => stored,
        set: (value: unknown): void => {
            onWrite();
            stored = value;
        },
    });
}

/**
 * Watch the accepted badge's foreign key and the reference that carries it.
 *
 * Installed only after acceptance, so every write it sees is a write to an
 * operation the tracker already committed. `onWrite` runs before the value
 * lands, so a throwing observer refuses the write the way a validating or
 * event-publishing setter in real domain code would.
 */
function countForeignKeyWrites(
    badge: LateBadge,
    onWrite: () => void = (): void => undefined,
): () => number {
    let writes = 0;
    const record = (): void => {
        writes += 1;
        onWrite();
    };
    interceptWrites(badge, 'holderId', record);
    interceptWrites(badge, 'holder', record);
    return (): number => writes;
}

/** Everything the accepted move is still entitled to after the load failed. */
async function expectMoveIntact(run: AcceptedMove): Promise<void> {
    const { db, badge, previous, next } = run;
    expect(badge.holder).toBe(next);
    expect(badge.holderId).toBe('h2');
    // Both inverse sides stand where the accepted move left them.
    expect(next.badge).toBe(badge);
    expect(previous.badge).toBeNull();
    const entry = requireDefined(db.entry(badge));
    // The baseline the acceptance committed, not the one the load found.
    expect(entry.originalValues.holderId).toBe('h2');
    expect(entry.modifiedProperties()).toEqual([]);
    expect(entry.state).toBe(EntityState.Unchanged);
    expect(trackedIds(db)).toEqual(['b1', 'h1', 'h2', 'p1']);
    expect(db.changeTracker.entries().every(
        row => row.state === EntityState.Unchanged,
    )).toBe(true);
    await expect(db.saveChanges()).resolves.toBe(0);
    // A failed unrelated read is an ordinary error, not a poisoned context.
    await expect(db.badges.count()).resolves.toBe(2);
    await expect(storedBadgeIds(db)).resolves.toEqual(['b1', 'b2']);
}

describe('navigation load rollback of unrelated accepted work', () => {
    it('replays no accepted relationship after an unrelated load fails', async () => {
        const run = await acceptMoveWhileLoadPending();
        const writes = countForeignKeyWrites(run.badge);

        const failure = await rejection(async () => run.loading);

        expect(refusalMessage(failure)).toContain('no such table');
        run.db.changeTracker.detectChanges();

        // Participation, not membership: the load never changed this entry's
        // facts, so its rollback has nothing of the accepted move to hand back
        // and change detection has no already-committed relationship to repeat.
        expect(writes()).toBe(0);
        await expectMoveIntact(run);
        await run.db.dispose();
    });

    it('detects changes after an unrelated load fails when a replay would throw', async () => {
        const run = await acceptMoveWhileLoadPending();
        const writes = countForeignKeyWrites(run.badge, (): void => {
            throw new Error('accepted relationship was replayed');
        });

        const failure = await rejection(async () => run.loading);

        expect(refusalMessage(failure)).toContain('no such table');
        // A setter that refuses a second write is the honest observer: whether
        // change detection succeeds must not depend on an unrelated query.
        expect((): void => {
            run.db.changeTracker.detectChanges();
        }).not.toThrow();
        expect(writes()).toBe(0);
        await expectMoveIntact(run);
        await run.db.dispose();
    });
});
