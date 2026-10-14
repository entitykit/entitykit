import { EntityState } from '../packages/core/src';
import { ModelBuilder } from '../packages/core/src/model/model-builder';
import type { EntityMetadata } from '../packages/core/src/model/entity-metadata';
import { ChangeTracker } from '../packages/core/src/tracking/change-tracker';
import * as acceptanceFactory from '../packages/core/src/tracking/change-tracker-acceptance-factory';
import { captureManualAcceptanceSnapshot } from '../packages/core/src/tracking/persisted-entry-snapshot';
import { RestorationScope } from '../packages/core/src/restoration-scope';

class AcceptanceRow {
    public id = 1;
    public label = 'before';
}

function metadata(): EntityMetadata<AcceptanceRow> {
    return new ModelBuilder().entity(AcceptanceRow, entity => {
        entity.toTable('acceptance_rows');
        entity.hasKey(row => row.id);
        entity.property(row => row.id).hasColumnType('integer').isRequired();
        entity.property(row => row.label).hasColumnType('text').isRequired();
    }).build().getEntity(AcceptanceRow);
}

describe('tracker acceptance allocation lifetime', () => {
    afterEach(() => jest.restoreAllMocks());

    it('defers acceptance through reads and tracking, then reuses it across clears', () => {
        const model = metadata();
        const factory = jest.spyOn(acceptanceFactory, 'createChangeTrackerAcceptance');
        const tracker = new ChangeTracker();
        const row = new AcceptanceRow();
        expect(tracker.entry(row)).toBeUndefined();
        expect(tracker.entries()).toEqual([]);
        const entry = tracker.track(row, model, EntityState.Unchanged);
        row.label = 'first change';
        tracker.detectChanges();
        expect(entry.state).toBe(EntityState.Modified);
        expect(factory).not.toHaveBeenCalled();
        tracker.acceptAllChanges();
        expect(factory).toHaveBeenCalledTimes(1);
        expect(entry.state).toBe(EntityState.Unchanged);
        expect(entry.originalValues.label).toBe('first change');
        tracker.clear();
        expect(entry.state).toBe(EntityState.Detached);
        const next = Object.assign(new AcceptanceRow(), { id: 2, label: 'next' });
        const nextEntry = tracker.track(next, model, EntityState.Added);
        tracker.acceptAllChanges();
        expect(factory).toHaveBeenCalledTimes(1);
        expect(tracker.entries()).toEqual([nextEntry]);
        expect(nextEntry.state).toBe(EntityState.Unchanged);
        expect(nextEntry.originalValues.label).toBe('next');
    });

    it('initializes from persisted acceptance and preserves rollback before later manual acceptance', () => {
        const model = metadata();
        const factory = jest.spyOn(acceptanceFactory, 'createChangeTrackerAcceptance');
        const tracker = new ChangeTracker();
        const row = new AcceptanceRow();
        const entry = tracker.track(row, model, EntityState.Unchanged);
        row.label = 'persisted';
        tracker.detectChanges();
        const snapshot = captureManualAcceptanceSnapshot(tracker.entries()[0]);
        expect(factory).not.toHaveBeenCalled();
        const poison = jest.fn();
        const receipt = tracker.acceptPersistedChanges([snapshot], new RestorationScope(poison));
        expect(factory).toHaveBeenCalledTimes(1);
        expect(entry.originalValues.label).toBe('persisted');
        expect(entry.state).toBe(EntityState.Unchanged);
        receipt.rollback();
        expect(entry.originalValues.label).toBe('before');
        expect(entry.state).toBe(EntityState.Modified);
        expect(tracker.entry(row)).toBe(entry);
        const retry = tracker.acceptPersistedChanges([snapshot], new RestorationScope(poison));
        retry.commit();
        expect(factory).toHaveBeenCalledTimes(1);
        expect(entry.originalValues.label).toBe('persisted');
        row.label = 'later';
        tracker.acceptAllChanges();
        expect(factory).toHaveBeenCalledTimes(1);
        expect(entry.originalValues.label).toBe('later');
        expect(entry.state).toBe(EntityState.Unchanged);
        expect(poison).not.toHaveBeenCalled();
    });

    it('keeps acceptance ownership independent between trackers', () => {
        const model = metadata();
        const factory = jest.spyOn(acceptanceFactory, 'createChangeTrackerAcceptance');
        const first = new ChangeTracker();
        const second = new ChangeTracker();
        const firstRow = new AcceptanceRow();
        const secondRow = new AcceptanceRow();
        const firstEntry = first.track(firstRow, model, EntityState.Unchanged);
        const secondEntry = second.track(secondRow, model, EntityState.Unchanged);
        firstRow.label = 'first';
        secondRow.label = 'second';
        expect(factory).not.toHaveBeenCalled();
        first.acceptAllChanges();
        expect(factory).toHaveBeenCalledTimes(1);
        expect(firstEntry.originalValues.label).toBe('first');
        expect(secondEntry.originalValues.label).toBe('before');
        second.acceptAllChanges();
        expect(factory).toHaveBeenCalledTimes(2);
        expect(secondEntry.originalValues.label).toBe('second');
        first.clear();
        expect(second.entry(secondRow)).toBe(secondEntry);
    });

    it('refuses unusable manual acceptance before allocating its helper', () => {
        const failure = new Error('unusable');
        const guard = jest.fn((operation: string) => {
            expect(operation).toBe('acceptAllChanges()');
            throw failure;
        });
        const tracker = new ChangeTracker(guard);
        const factory = jest.spyOn(acceptanceFactory, 'createChangeTrackerAcceptance');
        expect(() => {
            tracker.acceptAllChanges();
        }).toThrow(failure);
        expect(factory).not.toHaveBeenCalled();
        expect(guard).toHaveBeenCalledTimes(1);
    });

    it('notifies only the removed entity before notifying completed manual acceptance', () => {
        const model = metadata();
        const tracker = new ChangeTracker();
        const removed = new AcceptanceRow();
        const retained = Object.assign(new AcceptanceRow(), { id: 2 });
        tracker.track(removed, model, EntityState.Deleted);
        const retainedEntry = tracker.track(retained, model, EntityState.Added);
        const notifications: unknown[] = [];
        tracker.observeDetached(entity => {
            notifications.push(entity);
            return undefined;
        });
        tracker.observeAcceptedAll(() => {
            notifications.push('accepted');
        });
        tracker.acceptAllChanges();
        expect(notifications).toEqual([removed, 'accepted']);
        expect(tracker.entries()).toEqual([retainedEntry]);
        expect(retainedEntry.state).toBe(EntityState.Unchanged);
    });

    it('accepts a persisted replacement key through the initialized helper', () => {
        const model = metadata();
        const tracker = new ChangeTracker();
        const row = new AcceptanceRow();
        const entry = tracker.track(row, model, EntityState.Unchanged);
        row.id = 2;
        const snapshot = captureManualAcceptanceSnapshot(tracker.entries()[0]);
        const receipt = tracker.acceptPersistedChanges([snapshot], new RestorationScope(() => undefined));
        receipt.commit();
        expect(entry.originalValues.id).toBe(2);
        expect(tracker.tryGetByIdentity(model, 1)).toBeUndefined();
        expect(tracker.tryGetByIdentity(model, 2)).toBe(entry);
    });
});
