import { EntityState } from '../packages/core/src';
import { ModelBuilder } from '../packages/core/src/model/model-builder';
import type { EntityEntry } from '../packages/core/src/tracking/entity-entry';
import { ChangeTracker } from '../packages/core/src/tracking/change-tracker';
import { SaveMutationGuard } from '../packages/core/src/tracking/save-mutation-guard';

class ReservedRow {
    public id = 1;
}

const metadata = new ModelBuilder().entity(ReservedRow, entity => {
    entity.toTable('reserved_rows').hasKey(row => row.id);
    entity.property(row => row.id).hasColumnType('integer').isRequired();
}).build().getEntity(ReservedRow);

function entry(): EntityEntry<object> {
    const tracker = new ChangeTracker();
    tracker.track(new ReservedRow(), metadata, EntityState.Unchanged);
    return tracker.entries()[0];
}

function countMaps(action: () => void): readonly number[] {
    const NativeMap = Map;
    const NativeWeakMap = WeakMap;
    let maps = 0;
    let weakMaps = 0;
    const mapSpy = jest.spyOn(globalThis, 'Map').mockImplementation(values => {
        maps += 1;
        return new NativeMap(values);
    });
    const weakSpy = jest.spyOn(globalThis, 'WeakMap').mockImplementation(values => {
        weakMaps += 1;
        return new NativeWeakMap(values);
    });
    try {
        action();
        return [maps, weakMaps];
    } finally {
        weakSpy.mockRestore();
        mapSpy.mockRestore();
    }
}

describe('lazy save reservation ownership', () => {
    it('keeps construction, mutation checks and execution scopes free of reservation maps', () => {
        const counts = countMaps(() => {
            const guard = new SaveMutationGuard();
            guard.assertMutation('empty');
            guard.assertMutation('unreserved', {}, 'missing');
            const finish = guard.beginExecution();
            finish();
            finish();
            guard.assertNoExecution('finished');
        });
        expect(counts).toEqual([0, 0]);
    });

    it('creates only upsert storage and reuses it after release', () => {
        const entity = {};
        const counts = countMaps(() => {
            const guard = new SaveMutationGuard();
            const release = guard.reserveUpsertInputs([entity, entity]);
            release();
            release();
            guard.reserveUpsertInputs([entity])();
        });
        expect(counts).toEqual([0, 1]);
    });

    it('creates only deferred-save storage and reuses it after release', () => {
        const saved = entry();
        const counts = countMaps(() => {
            const guard = new SaveMutationGuard();
            const release = guard.defer([saved, saved], ['key', 'key']);
            release();
            release();
            guard.defer([saved], ['key'])();
        });
        expect(counts).toEqual([1, 1]);
    });

    it('keeps overlapping entity and identity reservations until their last release', () => {
        const guard = new SaveMutationGuard();
        const saved = entry();
        const unrelated = {};
        const first = guard.defer([saved, saved], ['key', 'key']);
        const second = guard.defer([saved], ['key']);
        expect(() => {
            guard.assertMutation('entity', saved.entity);
        }).toThrow('open transaction');
        expect(() => {
            guard.assertMutation('identity', unrelated, 'key');
        }).toThrow('open transaction');
        expect(() => {
            guard.assertMutation('all');
        }).toThrow('open transaction');
        expect(() => {
            guard.assertMutation('other', unrelated, 'other');
        }).not.toThrow();
        first();
        first();
        expect(() => {
            guard.assertMutation('entity', saved.entity);
        }).toThrow('open transaction');
        expect(() => {
            guard.assertMutation('identity', unrelated, 'key');
        }).toThrow('open transaction');
        expect(() => {
            guard.assertMutation('all');
        }).toThrow('open transaction');
        second();
        second();
        expect(() => {
            guard.assertMutation('entity', saved.entity);
        }).not.toThrow();
        expect(() => {
            guard.assertMutation('identity', unrelated, 'key');
        }).not.toThrow();
        expect(() => {
            guard.assertMutation('all');
        }).not.toThrow();
    });

    it('keeps identity-only and empty reservations separate from global entity counts', () => {
        const guard = new SaveMutationGuard();
        const empty = guard.defer([], []);
        const identity = guard.defer([], ['']);
        expect(() => {
            guard.assertMutation('all');
        }).not.toThrow();
        expect(() => {
            guard.assertMutation('empty key', {}, '');
        }).toThrow('open transaction');
        empty();
        expect(() => {
            guard.assertMutation('empty key', {}, '');
        }).toThrow('open transaction');
        identity();
        expect(() => {
            guard.assertMutation('empty key', {}, '');
        }).not.toThrow();
    });

    it('keeps upsert and save reservations independent across guards and releases', () => {
        const first = new SaveMutationGuard();
        const other = new SaveMutationGuard();
        const saved = entry();
        const finishSave = first.defer([saved], ['key']);
        const finishUpsert = first.reserveUpsertInputs([saved.entity]);
        expect(() => {
            first.assertMutation('all');
        }).toThrow('upsert input');
        expect(() => {
            first.assertMutation('entity', saved.entity);
        }).toThrow('upsert input');
        expect(() => {
            other.assertMutation('entity', saved.entity, 'key');
        }).not.toThrow();
        finishUpsert();
        expect(() => {
            first.assertMutation('entity', saved.entity);
        }).toThrow('open transaction');
        finishSave();
        expect(() => {
            first.assertMutation('all');
        }).not.toThrow();
        const empty = first.reserveUpsertInputs([]);
        expect(() => {
            first.assertMutation('all');
        }).not.toThrow();
        empty();
    });

    it('checks the current usability callback before execution and reservation failures', () => {
        const before = jest.fn();
        const guard = new SaveMutationGuard(before);
        const finish = guard.beginExecution();
        const finishNested = guard.beginExecution();
        finish();
        finish();
        expect(() => {
            guard.assertMutation('during execution');
        }).toThrow('during execution cannot change tracked structure while saveChanges() SQL is executing');
        finishNested();
        const release = guard.reserveUpsertInputs([{}]);
        const failure = new Error('unusable');
        const after = jest.fn(() => {
            throw failure;
        });
        guard.useUsabilityGuard(after);
        expect(() => {
            guard.assertMutation('guard first');
        }).toThrow(failure);
        expect(() => guard.reserveUpsertInputs([])).toThrow(failure);
        expect(() => guard.beginExecution()).toThrow(failure);
        expect(after.mock.calls).toEqual([['guard first'], ['upsert()'], ['saveChanges()']]);
        expect(before.mock.calls).toEqual([
            ['saveChanges()'], ['saveChanges()'], ['during execution'], ['upsert()'],
        ]);
        release();
    });

    it('does not let an old release remove newer or unrelated upsert reservations', () => {
        const guard = new SaveMutationGuard();
        const first = {};
        const second = {};
        const releaseFirst = guard.reserveUpsertInputs([first, first]);
        const releaseSecond = guard.reserveUpsertInputs([second]);
        expect(() => guard.reserveUpsertInputs([second])).toThrow('upsert() cannot proceed');
        releaseFirst();
        releaseFirst();
        expect(() => {
            guard.assertMutation('all');
        }).toThrow('upsert input');
        const releaseAgain = guard.reserveUpsertInputs([first]);
        releaseFirst();
        expect(() => {
            guard.assertMutation('first', first);
        }).toThrow('upsert input');
        releaseSecond();
        releaseAgain();
        expect(() => {
            guard.assertMutation('all');
        }).not.toThrow();
    });
});
