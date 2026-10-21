import { DbContext, EntityState, type ModelBuilder, valueConverter } from '../packages/core/src';
import { ModelBuilder as ModelBuilderImplementation } from '../packages/core/src/model/model-builder';
import { ChangeTracker } from '../packages/core/src/tracking/change-tracker';
import * as registryModule from '../packages/core/src/tracking/change-tracker-registry';
import { configureChangeTrackerModel } from '../packages/core/src/tracking/change-tracker-model';
import { RestorationScope } from '../packages/core/src/restoration-scope';
import { createSqliteDataSource } from '../packages/sqlite/src';

class RegistryRow {
    public id = 1;
    public label = 'before';
}

function configure(model: ModelBuilder): void {
    model.entity(RegistryRow, entity => {
        entity.toTable('registry_rows').hasKey(row => row.id);
        entity.property(row => row.id).hasColumnType('integer').isRequired();
        entity.property(row => row.label).hasColumnType('text').isRequired();
    });
}

const builder = new ModelBuilderImplementation();
configure(builder);
const model = builder.build();
const metadata = model.getEntity(RegistryRow);
const Registry = registryModule.ChangeTrackerRegistry;

class RegistryContext extends DbContext {
    public readonly rows = this.set(RegistryRow);
    protected override model(builder: ModelBuilder): void {
        configure(builder);
    }
}

describe('lazy tracker registry ownership', () => {
    let allocations: jest.SpyInstance<InstanceType<typeof Registry>, ConstructorParameters<typeof Registry>>;
    beforeEach(() => {
        allocations = jest.spyOn(registryModule, 'ChangeTrackerRegistry')
            .mockImplementation((...args) => new Registry(...args));
    });
    afterEach(() => jest.restoreAllMocks());

    it('keeps empty reads, detach and clear free of registry allocation', () => {
        const tracker = new ChangeTracker();
        const row = new RegistryRow();
        expect(tracker.entry(row)).toBeUndefined();
        const first = tracker.entries();
        expect(first).toEqual([]);
        expect(tracker.entries()).not.toBe(first);
        expect(tracker.detach(row)).toBeUndefined();
        tracker.clear();
        expect(tracker.hasQueuedWork(row)).toBe(false);
        expect(allocations).not.toHaveBeenCalled();
    });

    it('allocates once and retains registry identity across acceptance and clear', () => {
        const tracker = new ChangeTracker();
        const tracked = jest.fn(() => undefined);
        const detached = jest.fn(() => undefined);
        tracker.observeTracked(tracked);
        tracker.observeDetached(detached);
        expect(allocations).not.toHaveBeenCalled();
        const first = new RegistryRow();
        const entry = tracker.track(first, metadata, EntityState.Unchanged);
        expect(allocations).toHaveBeenCalledTimes(1);
        expect(tracker.entry(first)).toBe(entry);
        tracker.acceptAllChanges();
        tracker.clear();
        const second = new RegistryRow();
        const next = tracker.track(second, metadata, EntityState.Added);
        tracker.acceptAllChanges();
        expect(next.state).toBe(EntityState.Unchanged);
        expect(tracker.tryGetByIdentity(metadata, 1)).toBe(next);
        expect(tracker.entries()).toEqual([next]);
        expect(allocations).toHaveBeenCalledTimes(1);
        expect(tracked.mock.calls).toEqual([[first], [second]]);
        expect(detached.mock.calls).toEqual([[first]]);
    });

    it('keeps registries independent for trackers with equal keys', () => {
        const first = new ChangeTracker();
        const second = new ChangeTracker();
        const a = new RegistryRow();
        const b = new RegistryRow();
        const aEntry = first.track(a, metadata, EntityState.Unchanged);
        const bEntry = second.track(b, metadata, EntityState.Unchanged);
        expect(allocations).toHaveBeenCalledTimes(2);
        expect(first.tryGetByIdentity(metadata, 1)).toBe(aEntry);
        expect(second.tryGetByIdentity(metadata, 1)).toBe(bEntry);
        first.clear();
        expect(second.entry(b)).toBe(bEntry);
    });

    it('notifies detach only for an entry removed from an initialized registry', () => {
        const tracker = new ChangeTracker();
        const detached = jest.fn(() => undefined);
        tracker.observeDetached(detached);
        const row = new RegistryRow();
        expect(tracker.detach(row)).toBeUndefined();
        expect(detached).not.toHaveBeenCalled();
        const entry = tracker.track(row, metadata, EntityState.Unchanged);
        expect(tracker.detach(new RegistryRow())).toBeUndefined();
        expect(detached).not.toHaveBeenCalled();
        expect(tracker.detach(row)).toBe(entry);
        expect(entry.state).toBe(EntityState.Detached);
        expect(tracker.detach(row)).toBeUndefined();
        expect(detached.mock.calls).toEqual([[row]]);
        expect(tracker.entries()).toEqual([]);
    });

    it('still invokes key converters during empty identity lookups', () => {
        const failure = new Error('key conversion failed');
        const convert = jest.fn(() => {
            throw failure;
        });
        const converted = new ModelBuilderImplementation().entity(RegistryRow, entity => {
            entity.toTable('converted_rows').hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired()
                .hasConversion(valueConverter<number, number>({
                    toProvider: convert, fromProvider: value => value,
                }));
        }).build().getEntity(RegistryRow);
        const tracker = new ChangeTracker();
        expect(() => tracker.tryGetByIdentity(converted, 1)).toThrow(failure);
        expect(convert).toHaveBeenCalledWith(1);
    });

    it('initializes empty configured relationship journals and preserves callbacks', () => {
        const tracker = new ChangeTracker();
        configureChangeTrackerModel(tracker, model);
        const beforeCommit = jest.fn();
        const poison = jest.fn();
        tracker.detectSaveRelationships([], undefined, true, new RestorationScope(poison), beforeCommit);
        expect(beforeCommit).toHaveBeenCalledTimes(1);
        expect(allocations).toHaveBeenCalledTimes(1);
        const failure = new Error('before commit failed');
        expect(() => {
            tracker.detectSaveRelationships(
                [], undefined, true, new RestorationScope(poison), () => {
                    throw failure;
                },
            );
        }).toThrow(failure);
        expect(poison).not.toHaveBeenCalled();
        expect(tracker.entries()).toEqual([]);
    });

    it('preserves unusable, active-save and upsert guards before allocating storage', () => {
        const failure = new Error('unusable');
        const operations: string[] = [];
        const unusable = new ChangeTracker(operation => {
            operations.push(operation);
            throw failure;
        });
        expect(() => {
            unusable.clear();
        }).toThrow(failure);
        expect(() => unusable.detach(new RegistryRow())).toThrow(failure);
        expect(() => {
            unusable.detectSaveRelationships();
        }).toThrow(failure);
        expect(operations).toEqual([
            'Clearing tracked entities', 'Detaching an entity', 'detectSaveRelationships()',
        ]);
        const tracker = new ChangeTracker();
        const row = new RegistryRow();
        const end = tracker.beginSaveExecution();
        expect(() => {
            tracker.clear();
        }).toThrow('while saveChanges() SQL is executing');
        expect(() => tracker.detach(row)).toThrow('while saveChanges() SQL is executing');
        end();
        const release = tracker.reserveUntrackedEntities([row]);
        expect(() => {
            tracker.clear();
        }).toThrow('upsert input');
        expect(() => tracker.detach(row)).toThrow('upsert input');
        release();
        tracker.clear();
        expect(allocations).not.toHaveBeenCalled();
    });

    it('binds the first registry to its save guard before tracking can publish an entry', () => {
        const tracker = new ChangeTracker();
        const row = new RegistryRow();
        const end = tracker.beginSaveExecution();
        expect(() => tracker.track(row, metadata, EntityState.Added))
            .toThrow('while saveChanges() SQL is executing');
        expect(tracker.entry(row)).toBeUndefined();
        expect(allocations).toHaveBeenCalledTimes(1);
        end();
        const release = tracker.reserveUntrackedEntities([row]);
        expect(() => tracker.track(row, metadata, EntityState.Added)).toThrow('upsert input');
        expect(tracker.entries()).toEqual([]);
        release();
        const entry = tracker.track(row, metadata, EntityState.Unchanged);
        expect(tracker.entry(row)).toBe(entry);
        expect(allocations).toHaveBeenCalledTimes(1);
    });

    it('does not allocate registries for a fresh context no-tracking query', async () => {
        const source = createSqliteDataSource(':memory:');
        try {
            await using db = source.createContext(RegistryContext);
            await db.database.connection.query({ text: db.database.createScript(), values: [] });
            await db.database.connection.query({
                text: 'insert into registry_rows (id, label) values (1, \'before\')', values: [],
            });
            const row = await db.rows.asNoTracking().first();
            expect(row.label).toBe('before');
            expect(db.entry(row)).toBeUndefined();
            expect(db.changeTracker.entries()).toEqual([]);
            expect(allocations).not.toHaveBeenCalled();
            const tracked = await db.rows.findOrThrow(1);
            expect(db.entry(tracked)).toBeDefined();
            await expect(db.rows.findOrThrow(1)).resolves.toBe(tracked);
            expect(allocations).toHaveBeenCalledTimes(1);
        } finally {
            await source.dispose();
        }
    });
});
