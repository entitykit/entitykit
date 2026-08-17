/**
 * The value half of an ownership fingerprint, one captured fact at a time.
 *
 * A checkpoint is data: the entry's own baseline by reference, a copy of its
 * bound values, the identity it was registered under. Perturbing one field of
 * a real capture is the only way to ask which of them a refusal saw, and it is
 * the honest direction too -- these are exactly the facts that move when an
 * acceptance replaces a baseline or a re-registration moves an identity out
 * from under a load that is still unwinding.
 */
import type {
    OwnedEntryCheckpoint,
} from '../src/tracking/navigation-load-ownership-checkpoint';
import {
    ownedEntryMatchesCheckpoint,
} from '../src/tracking/navigation-load-ownership-comparison';
import {
    detachOwnedRegistrations,
    fingerprintOwnedRegistration,
    recordOwnedRegistration,
} from '../src/tracking/navigation-load-ownership';
import {
    codeConversions,
    deferredCode,
    registerOwnedTag,
} from './support/navigation-load-ownership-fact-support';
import {
    ownershipRefusal,
} from './support/navigation-load-ownership-support';

/** The same capture with one recorded value replaced. */
function withValues(
    checkpoint: OwnedEntryCheckpoint,
    values: Readonly<Record<string, unknown>>,
): OwnedEntryCheckpoint {
    return { ...checkpoint, originalValues: { ...checkpoint.originalValues, ...values } };
}

describe('the values an ownership fingerprint compares', () => {
    it('runs no converter over a baseline the entry still holds', () => {
        const { tracker, entry, checkpoint } = registerOwnedTag();

        // Registration and capture ran conversions of their own; from here
        // every one recorded belongs to the comparison.
        codeConversions.length = 0;
        expect(ownedEntryMatchesCheckpoint(tracker, entry, checkpoint))
            .toBe(true);

        // Three conversions, all of them the live leg's: one to read the
        // entity's current values, then one per side of the single comparison
        // against the pre-image. The baseline leg compares the object the
        // entry still holds against itself, and no converter can improve on
        // that answer -- running one anyway would double this count and ask a
        // converter to be stable across a round trip it never promised.
        expect(codeConversions).toEqual(['ts', 'ts', 'ts']);
    });

    it('refuses an entry whose identity registration moved', () => {
        const { tracker, entry, checkpoint } = registerOwnedTag();

        expect(ownedEntryMatchesCheckpoint(tracker, entry, {
            ...checkpoint, identityKey: 'MarkTag:re-registered',
        })).toBe(false);
    });

    it('refuses a captured key no property claims', () => {
        const { tracker, entry, checkpoint } = registerOwnedTag();

        // An unmapped key is not the store's to own, so it stays judged: the
        // union of both sides is compared, and a key only the capture knows
        // about is a difference rather than a property to look up and skip.
        expect(ownedEntryMatchesCheckpoint(
            tracker, entry, withValues(checkpoint, { phantom: 'unmapped' }),
        )).toBe(false);
    });

    it('names the property whose converter refused the comparison', () => {
        const { tracker, entry, checkpoint } = registerOwnedTag();

        // An unreadable fingerprint is not a matching one, and the report has
        // to say which property could not be read: the caller turns this into
        // a refusal, and a refusal naming nothing is undiagnosable.
        expect(() => ownedEntryMatchesCheckpoint(
            tracker, entry, withValues(checkpoint, { code: deferredCode }),
        )).toThrow('Value converter for \'MarkTag.code\' toProvider()');
    });

    it('refuses one bound fact moved under the pre-image', () => {
        const { tracker, entry, checkpoint } = registerOwnedTag();

        // Bound values are provider facts, already converted, and every one of
        // them is compared: the two that still agree cannot vouch for the
        // third.
        expect(ownedEntryMatchesCheckpoint(tracker, entry, {
            ...checkpoint,
            originalBoundValues: {
                ...checkpoint.originalBoundValues, ownerId: 'deep_2',
            },
        })).toBe(false);
    });
});

describe('the registration a failed load reads back', () => {
    it('refuses one that never got a fingerprint, asking nothing else', () => {
        const { tracker, entry, tag } = registerOwnedTag();
        const probed: object[] = [];
        tracker.observeQueuedWork(entity => {
            probed.push(entity);
            return false;
        });

        // A capture that threw leaves a registration with no fingerprint at
        // all. There is nothing to compare and nothing that could prove the
        // entry is still only the load's, so the refusal is reached before
        // anything else is consulted.
        const registration = recordOwnedRegistration(entry);
        expect(() => {
            detachOwnedRegistrations(tracker, [registration]);
        }).toThrow(ownershipRefusal('MarkTag'));

        expect(probed).toEqual([]);
        expect(tracker.entry(tag)).toBe(entry);
    });

    it('detaches one whose fingerprint still stands, after asking', () => {
        const { tracker, entry, tag } = registerOwnedTag();
        const probed: object[] = [];
        tracker.observeQueuedWork(entity => {
            probed.push(entity);
            return false;
        });

        const registration = recordOwnedRegistration(entry);
        fingerprintOwnedRegistration(tracker, registration);
        detachOwnedRegistrations(tracker, [registration]);

        expect(probed).toEqual([tag]);
        expect(tracker.entry(tag)).toBeUndefined();
    });
});
