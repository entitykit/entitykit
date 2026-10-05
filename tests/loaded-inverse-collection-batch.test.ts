import { RelationshipCardinality } from '../packages/core/src/model/relationship-metadata';
import { LoadedInverseCollectionBatch } from '../packages/core/src/tracking/loaded-inverse-collection-batch';
import { NavigationWriteJournal } from '../packages/core/src/tracking/navigation-write-journal';
import { createNavigationLoadTrackerJournal } from '../packages/core/src/tracking/navigation-load-tracker-journal';
import type { TrackedRelationshipMetadata } from '../packages/core/src/tracking/tracked-relationship-metadata';
import { RefusalDependent, RefusalGraphContext, RefusalPrincipal } from './support/accessor-refusal-support';
import { internalChangeTracker } from './support/public-api-internals';
import { requireDefined } from './support/require-defined';

describe('batched loaded inverse collections', () => {
    it('preserves existing duplicate slots and deduplicates new additions', async () => {
        const fixture = createBatch();
        try {
            const existing = new RefusalDependent();
            fixture.parent.dependents = [existing, existing];
            expect(fixture.batch.add(fixture.relationship, fixture.parent, fixture.child)).toBe(true);
            expect(fixture.batch.add(fixture.relationship, fixture.parent, fixture.child)).toBe(true);
            fixture.batch.publish();
            expect(fixture.parent.dependents).toEqual([existing, existing, fixture.child]);
            expect(() => {
                fixture.batch.publish();
            }).not.toThrow();
        } finally {
            await fixture.db.dispose();
        }
    });

    it('removes every old slot and puts a re-added child last', async () => {
        const fixture = createBatch();
        try {
            const other = new RefusalDependent();
            fixture.parent.dependents = [fixture.child, fixture.child, other];
            expect(fixture.batch.remove(fixture.relationship, fixture.parent, fixture.child)).toBe(true);
            expect(fixture.batch.remove(fixture.relationship, fixture.parent, new RefusalDependent())).toBe(true);
            expect(fixture.batch.add(fixture.relationship, fixture.parent, fixture.child)).toBe(true);
            fixture.batch.publish();
            expect(fixture.parent.dependents).toEqual([other, fixture.child]);
        } finally {
            await fixture.db.dispose();
        }
    });

    it('leaves reference inverses and unmapped or untracked principals to immediate fixup', async () => {
        const fixture = createBatch();
        try {
            const oneToOne = { ...fixture.relationship, cardinality: RelationshipCardinality.OneToOne };
            const noInverse = { ...fixture.relationship, inverseNavigationProperty: undefined };
            for (const relationship of [oneToOne, noInverse]) {
                expect(fixture.batch.add(relationship, fixture.parent, fixture.child)).toBe(false);
                expect(fixture.batch.remove(relationship, fixture.parent, fixture.child)).toBe(false);
            }
            const untracked = new RefusalPrincipal();
            expect(fixture.batch.add(fixture.relationship, untracked, fixture.child)).toBe(false);
            expect(fixture.batch.remove(fixture.relationship, untracked, fixture.child)).toBe(false);
            fixture.batch.publish();
            expect(fixture.parent.dependents).toEqual([]);
        } finally {
            await fixture.db.dispose();
        }
    });

    it('initializes an absent collection without treating it as a collection removal', async () => {
        const fixture = createBatch();
        try {
            Reflect.deleteProperty(fixture.parent, 'dependents');
            expect(fixture.batch.remove(fixture.relationship, fixture.parent, fixture.child)).toBe(false);
            expect(fixture.batch.add(fixture.relationship, fixture.parent, fixture.child)).toBe(true);
            fixture.batch.publish();
            expect(fixture.parent.dependents).toEqual([fixture.child]);
        } finally {
            await fixture.db.dispose();
        }
    });

    it.each(['collection', 'detach', 'reattach'])('refuses a superseded %s before publishing', async kind => {
        const fixture = createBatch();
        try {
            fixture.batch.add(fixture.relationship, fixture.parent, fixture.child);
            if (kind === 'collection') fixture.parent.dependents.push(new RefusalDependent());
            else {
                fixture.tracker.detach(fixture.parent);
                if (kind === 'reattach') fixture.db.principals.attach(fixture.parent);
            }
            const newer = [...fixture.parent.dependents];
            expect(() => {
                fixture.batch.publish();
            }).toThrow(
                'Navigation \'RefusalPrincipal.dependents\' changed while its load was in progress.',
            );
            expect(fixture.parent.dependents).toEqual(newer);
        } finally {
            await fixture.db.dispose();
        }
    });
});

function createBatch(): {
    db: RefusalGraphContext;
    parent: RefusalPrincipal;
    child: RefusalDependent;
    tracker: ReturnType<typeof internalChangeTracker>;
    relationship: TrackedRelationshipMetadata;
    batch: LoadedInverseCollectionBatch;
} {
    const db = RefusalGraphContext.create();
    const parent = Object.assign(new RefusalPrincipal(), { id: 'p1' });
    const child = Object.assign(new RefusalDependent(), { id: 'd1', principalId: 'p1' });
    db.principals.attach(parent);
    db.dependents.attach(child);
    const tracker = internalChangeTracker(db.changeTracker);
    const relationship = requireDefined(tracker.entry(child)?.metadata.relationships[0]) as TrackedRelationshipMetadata;
    const batch = new LoadedInverseCollectionBatch(tracker, new NavigationWriteJournal(),
        createNavigationLoadTrackerJournal(tracker));
    return { db, parent, child, tracker, relationship, batch };
}
