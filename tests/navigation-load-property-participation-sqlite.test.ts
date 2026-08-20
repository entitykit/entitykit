import { EntityState } from '../packages/core/src';
import type { EntityEntry as TrackedEntry } from '../packages/core/src/tracking/entity-entry';
import type { EntityEntry } from '../packages/core/src/tracking/entity-entry-types';
import {
    navigationChangeDetectionAllowed,
} from '../packages/core/src/tracking/navigation-change-detection-state';
import { navigationSnapshot } from '../packages/core/src/tracking/navigation-snapshot';
import { requireDefined } from './support/require-defined';
import { rejection } from './support/accessor-refusal-support';
import { internalEntityEntry } from './support/public-api-internals';
import type {
    PartDoc,
    PartParticipationContext,
    PartReviewer,
} from './support/nested-include-pause-support';
import {
    openParticipationGraph,
} from './support/nested-include-pause-support';

/** The tracker's own facts for one navigation of one entry. */
function trackedFacts(
    entry: EntityEntry<PartDoc>,
    property: string,
): { readonly baseline: unknown; readonly detectionAllowed: boolean } {
    const tracked =
        internalEntityEntry(entry) as unknown as TrackedEntry<object>;
    return {
        baseline: navigationSnapshot(tracked, property).value,
        detectionAllowed: navigationChangeDetectionAllowed(tracked, property),
    };
}

/** A nested include held open after its first level stitched the owner. */
interface PausedIncludeRun {
    readonly db: PartParticipationContext;
    readonly doc: PartDoc;
    /** The reviewer the doc is loaded against. */
    readonly first: PartReviewer;
    /** The reviewer an accepted move re-points the doc at. */
    readonly second: PartReviewer;
    readonly loading: Promise<unknown>;
}

/**
 * Stitch `doc.owner`, then hold the nested note query open.
 *
 * The first include level flags `doc.owner` loaded and re-captures its
 * baseline, which is the moment this load records participation in the doc.
 * The nested level is held before it can finish, so everything the test does
 * next happens with an unrelated failure already queued behind it -- and the
 * navigation that failure is entitled to take back is `owner`, not `reviewer`.
 */
async function pauseNestedInclude(
    loadOwnerFirst = false,
): Promise<PausedIncludeRun> {
    const db = await openParticipationGraph();
    const doc = requireDefined(await db.docs.find('doc1'));
    const entry = requireDefined(db.entry(doc));
    await entry.reference(row => row.reviewer).load();
    if (loadOwnerFirst) await entry.reference(row => row.owner).load();
    const first = requireDefined(doc.reviewer);
    const second = requireDefined(await db.reviewers.find('r2'));
    const reached = db.connection.pauseOn('part_notes');
    const loading = db.docs
        .include(row => row.owner)
        .thenInclude(row => row.notes)
        .toArray();
    await reached;
    return { db, doc, first, second, loading };
}

/** Move the doc to the other reviewer, both inverses, and accept it all. */
function acceptReviewerMove(run: PausedIncludeRun): void {
    const { db, doc, first, second } = run;
    doc.reviewer = second;
    first.docs = first.docs.filter(row => row !== doc);
    second.docs = [...second.docs, doc];
    db.changeTracker.detectChanges();
    db.changeTracker.acceptAllChanges();
}

/** Replace one property with an observer reporting every write asked of it. */
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
 * Watch the accepted reviewer move: its reference and the key that carries it.
 *
 * Installed only after acceptance, so every write it sees is a write to an
 * operation the tracker already committed. `onWrite` runs before the value
 * lands, so a throwing observer refuses the write the way a validating setter
 * in real domain code would.
 */
function countReviewerWrites(
    doc: PartDoc,
    onWrite: () => void = (): void => undefined,
): () => number {
    let writes = 0;
    const record = (): void => {
        writes += 1;
        onWrite();
    };
    interceptWrites(doc, 'reviewerId', record);
    interceptWrites(doc, 'reviewer', record);
    return (): number => writes;
}

/** Everything the accepted move keeps once the owner load has failed. */
async function expectReviewerMoveIntact(run: PausedIncludeRun): Promise<void> {
    const { db, doc, first, second } = run;
    expect(doc.reviewer).toBe(second);
    expect(doc.reviewerId).toBe('r2');
    expect(first.docs).toEqual([]);
    expect(second.docs).toHaveLength(1);
    expect(second.docs[0]).toBe(doc);
    const entry = requireDefined(db.entry(doc));
    expect(entry.originalValues.reviewerId).toBe('r2');
    // The baseline the acceptance committed, not the one the load found: a
    // stale identity here is exactly what change detection replays.
    expect(trackedFacts(entry, 'reviewer').baseline).toBe(second);
    expect(trackedFacts(entry, 'reviewer').detectionAllowed).toBe(true);
    // The accepted move re-pointed the key the loaded flag was recorded under,
    // and the failed load neither re-establishes nor invents one for it.
    expect(entry.isNavigationLoaded('reviewer')).toBe(false);
    expect(db.changeTracker.entries().map(row => row.state)).toEqual(
        db.changeTracker.entries().map(() => EntityState.Unchanged),
    );
    await expect(db.saveChanges()).resolves.toBe(0);
}

describe('navigation load participation per navigation property', () => {
    it('replays no accepted move when an unrelated nested load fails', async () => {
        const run = await pauseNestedInclude();
        acceptReviewerMove(run);
        const writes = countReviewerWrites(run.doc);
        const boom = new Error('nested note query refused');

        run.db.connection.failPaused(boom);

        expect(await rejection(async () => run.loading)).toBe(boom);
        run.db.changeTracker.detectChanges();

        // Participation is per navigation: the load changed `owner`, so it has
        // nothing of the accepted `reviewer` move to hand back and change
        // detection has no already-committed relationship to repeat.
        expect(writes()).toBe(0);
        await expectReviewerMoveIntact(run);
        await run.db.dispose();
    });

    it('detects changes after the nested load fails when a replay would throw', async () => {
        const run = await pauseNestedInclude();
        acceptReviewerMove(run);
        const writes = countReviewerWrites(run.doc, (): void => {
            throw new Error('accepted reviewer move was replayed');
        });
        const boom = new Error('nested note query refused');

        run.db.connection.failPaused(boom);

        expect(await rejection(async () => run.loading)).toBe(boom);
        // A setter that refuses a second write is the honest observer: whether
        // change detection succeeds must not depend on an unrelated query.
        expect((): void => {
            run.db.changeTracker.detectChanges();
        }).not.toThrow();
        expect(writes()).toBe(0);
        await expectReviewerMoveIntact(run);
        await run.db.dispose();
    });

    it('leaves an untouched navigation of the same entry where it stands', async () => {
        const run = await pauseNestedInclude(true);
        const { db, doc } = run;
        const entry = requireDefined(db.entry(doc));
        // The application deliberately stops trusting this reference as loaded,
        // after the load already recorded its participation in `owner`.
        internalEntityEntry(entry).markNavigationNotLoaded('reviewer');
        const boom = new Error('nested note query refused');

        db.connection.failPaused(boom);

        expect(await rejection(async () => run.loading)).toBe(boom);
        db.changeTracker.detectChanges();

        // `reviewer` was never this load's to capture, so neither its loaded
        // flag nor its suppression is rewound to what `owner`'s touch saw.
        expect(entry.isNavigationLoaded('reviewer')).toBe(false);
        expect(trackedFacts(entry, 'reviewer').detectionAllowed).toBe(false);
        // `owner` was, and the earlier successful load's flag is handed back.
        expect(doc.owner).toBe(requireDefined(await db.owners.find('o1')));
        expect(entry.isNavigationLoaded('owner')).toBe(true);
        expect(db.changeTracker.entries().map(row => row.state)).toEqual(
            db.changeTracker.entries().map(() => EntityState.Unchanged),
        );
        await expect(db.saveChanges()).resolves.toBe(0);

        // The restored flag is the keyed fact the earlier load recorded, not a
        // blanket "loaded": re-pointing the foreign key invalidates it again.
        doc.ownerId = 'o2';
        expect(entry.isNavigationLoaded('owner')).toBe(false);
        await db.dispose();
    });
});
