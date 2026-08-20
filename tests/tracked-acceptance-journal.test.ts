import type { EntityEntry } from '../packages/core/src/tracking/entity-entry';
import { EntityState } from '../packages/core/src/tracking/entity-state';
import type { TrackedIdentityMap } from '../packages/core/src/tracking/tracked-identity-map';
import {
    TrackedAcceptanceJournal,
    type AcceptanceCheckpoint,
} from '../packages/core/src/tracking/tracked-acceptance-journal';

describe('tracked acceptance journal', () => {
    it('attempts every rollback phase when identity preflight fails', () => {
        const failure = new Error('identity preflight failed');
        const restoreTrackedValues = jest.fn();
        const entry = { restoreTrackedValues } as unknown as EntityEntry<object>;
        const checkpoint: AcceptanceCheckpoint = {
            entry,
            state: EntityState.Modified,
            originalValues: { id: 'before' },
            originalBoundValues: { id: 'before' },
            navigations: new Map(),
            identityKey: 'identity',
        };
        const assertCanRestoreKeys = jest.fn(() => {
            throw failure;
        });
        const restoreKeys = jest.fn();
        const identities = {
            assertCanRestoreKeys,
            restoreKeys,
        } as unknown as TrackedIdentityMap;
        const restoreEntry = jest.fn();
        const assertInvariant = jest.fn();
        const release = jest.fn();
        const journal = new TrackedAcceptanceJournal(
            [checkpoint], identities, restoreEntry, release, assertInvariant,
        );

        expect(() => {
            journal.rollback();
        }).toThrow(failure);
        expect(restoreTrackedValues).toHaveBeenCalledTimes(1);
        expect(restoreEntry).toHaveBeenCalledWith(entry);
        expect(restoreKeys).toHaveBeenCalledTimes(1);
        expect(assertInvariant).toHaveBeenCalledTimes(1);
        expect(release).toHaveBeenCalledTimes(1);
        journal.rollback();
        expect(assertCanRestoreKeys).toHaveBeenCalledTimes(1);
    });
});
