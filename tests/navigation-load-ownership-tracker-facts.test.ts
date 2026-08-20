/**
 * The tracker facts an ownership fingerprint compares, one fact at a time.
 *
 * A navigation load moves several of these at once -- flagging a navigation
 * loaded captures its baseline and lifts its suppression in the same breath --
 * so a full include can never say which of them a refusal actually saw. Each
 * case here starts from the same registration and moves exactly one: a baseline
 * only, a loaded flag only, a suppression only. Both directions of a size
 * difference are covered too, because only the added key proves the size check
 * carries its own weight -- a removed one is caught by the walk over the
 * capture regardless.
 */
import {
    captureNavigation,
    acceptNavigationSnapshotValues,
} from '../packages/core/src/tracking/navigation-snapshot';
import {
    restoreEntryLoadedNavigations,
} from '../packages/core/src/tracking/entity-entry-navigation-checkpoint';
import {
    allowNavigationChangeDetection,
    suppressNavigationChangeDetection,
} from '../packages/core/src/tracking/navigation-change-detection-state';
import {
    ownedNavigationFactsMatch,
} from '../packages/core/src/tracking/navigation-load-ownership-facts';
import {
    ownedEntryMatchesCheckpoint,
} from '../packages/core/src/tracking/navigation-load-ownership-comparison';
import { registerOwnedTag } from './support/navigation-load-ownership-fact-support';

describe('the tracker facts an ownership fingerprint compares', () => {
    it('matches an entry standing exactly as registration left it', () => {
        const { tracker, entry, checkpoint } = registerOwnedTag();

        // The control every other case is measured against, and the only one
        // that proves the legs judge what they hold rather than reporting a
        // match by walking nothing: this capture carries two baselines, two
        // loaded flags, a suppressed navigation and a complex container, so
        // each leg has something of its own to agree with.
        expect(ownedNavigationFactsMatch(entry, checkpoint)).toBe(true);
        expect(ownedEntryMatchesCheckpoint(tracker, entry, checkpoint))
            .toBe(true);
    });

    it('refuses one navigation baseline moved to another graph', () => {
        const { tracker, entry, tag, other, checkpoint } = registerOwnedTag();

        // Accepting a baseline is what a save-time acceptance does: the live
        // entity is untouched, so only the tracked pre-image of `deep` moved
        // and the second navigation still agrees with its capture.
        acceptNavigationSnapshotValues(entry, new Map<string, unknown>([
            ['deep', other],
            ['owner', tag.owner],
        ]));

        expect(ownedNavigationFactsMatch(entry, checkpoint)).toBe(false);
        expect(ownedEntryMatchesCheckpoint(tracker, entry, checkpoint))
            .toBe(false);
    });

    it('refuses a navigation baseline this load never registered', () => {
        const { tracker, entry, checkpoint } = registerOwnedTag();

        // Every baseline the capture holds still matches; the entry simply
        // carries one more than it did, which only counting can see.
        captureNavigation(entry, 'notes');

        expect(ownedNavigationFactsMatch(entry, checkpoint)).toBe(false);
        expect(ownedEntryMatchesCheckpoint(tracker, entry, checkpoint))
            .toBe(false);
    });

    it('refuses a loaded flag moved to another reference key', () => {
        const { tracker, entry, checkpoint } = registerOwnedTag();

        // Same properties, same count, one different key: the navigation is
        // still flagged loaded, but for a reference the load never resolved.
        restoreEntryLoadedNavigations(entry, new Map([
            ['deep', 'moved-reference-key'],
            ['owner', checkpoint.loaded.get('owner') ?? null],
        ]));

        expect(ownedNavigationFactsMatch(entry, checkpoint)).toBe(false);
        expect(ownedEntryMatchesCheckpoint(tracker, entry, checkpoint))
            .toBe(false);
    });

    it('refuses a navigation flagged loaded after registration', () => {
        const { tracker, entry, checkpoint } = registerOwnedTag();

        restoreEntryLoadedNavigations(entry, new Map([
            ...checkpoint.loaded,
            ['notes', null],
        ]));

        expect(ownedNavigationFactsMatch(entry, checkpoint)).toBe(false);
        expect(ownedEntryMatchesCheckpoint(tracker, entry, checkpoint))
            .toBe(false);
    });

    it('refuses suppression moved from one navigation to another', () => {
        const { tracker, entry, checkpoint } = registerOwnedTag();

        // One in, one out. The set is the size the capture recorded, so only
        // comparing the properties themselves can see this.
        allowNavigationChangeDetection(entry, 'notes');
        suppressNavigationChangeDetection(entry, 'deep');

        expect(ownedNavigationFactsMatch(entry, checkpoint)).toBe(false);
        expect(ownedEntryMatchesCheckpoint(tracker, entry, checkpoint))
            .toBe(false);
    });

    it('refuses a navigation suppressed after registration', () => {
        const { tracker, entry, checkpoint } = registerOwnedTag();

        // Everything the capture suppressed is still suppressed; one more is
        // too, which again only counting can see.
        suppressNavigationChangeDetection(entry, 'deep');

        expect(ownedNavigationFactsMatch(entry, checkpoint)).toBe(false);
        expect(ownedEntryMatchesCheckpoint(tracker, entry, checkpoint))
            .toBe(false);
    });
});
