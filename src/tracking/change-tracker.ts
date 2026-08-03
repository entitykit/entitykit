import type { EntityMetadata } from '../model/entity-metadata';
import { ChangeTrackerAcceptance } from './change-tracker-acceptance';
import { formatChangeTracker } from './change-tracker-debug';
import { EntityEntry } from './entity-entry';
import { EntityState } from './entity-state';
import { TrackedIdentityMap } from './tracked-identity-map';
import { TrackingIdentityFactory } from './tracking-identity-factory';
import { changeTrackerModel, configureTrackedEntry } from './change-tracker-model';
import { initializeNavigationSnapshots } from './navigation-snapshot';
import { detectRelationshipChanges } from './relationship-change-detector';
import type { PersistedEntrySnapshot } from './persisted-entry-snapshot';

export class ChangeTracker {
    private entriesByEntity: WeakMap<object, EntityEntry<object>> = new WeakMap();
    private readonly identities = new TrackedIdentityMap();
    private readonly trackedEntries: Set<EntityEntry<object>> = new Set();
    private readonly identityFactory = new TrackingIdentityFactory();
    private readonly acceptance = new ChangeTrackerAcceptance(
        () => this.entries(),
        entry => this.trackedEntries.has(entry),
        this.identities,
        entity => {
            this.detach(entity);
        },
        entry => {
            this.entriesByEntity.set(entry.entity, entry);
            this.trackedEntries.add(entry);
        },
    );
    private onTracked?: (entity: object) => void;

    public observeTracked(observer: (entity: object) => void): void {
        this.onTracked = observer;
    }

    public track<TEntity extends object>(
        entity: TEntity,
        metadata: EntityMetadata<TEntity>,
        state: EntityState,
        originalValues?: Record<string, unknown>,
    ): EntityEntry<TEntity> {
        metadata.assertWritable('Tracking');
        const existingByObject = this.entriesByEntity.get(entity);
        if (existingByObject) {
            existingByObject.state = state;
            if (originalValues) {
                existingByObject.refreshOriginalValues(originalValues);
            }
            return existingByObject as unknown as EntityEntry<TEntity>;
        }
        const identityKey = this.identityFactory.create(
            entity,
            metadata,
            state,
        );
        const existingByIdentity = this.identities.get(identityKey);
        if (existingByIdentity) {
            if (state === EntityState.Unchanged) {
                return existingByIdentity as unknown as EntityEntry<TEntity>;
            }

            throw new Error(`An instance of '${metadata.entityName}' with key '${String(metadata.getKeyValue(entity))}' is already tracked.`);
        }

        const entry = new EntityEntry(entity, metadata, state, originalValues);
        configureTrackedEntry(this, entry as unknown as EntityEntry<object>);
        this.entriesByEntity.set(entity, entry as unknown as EntityEntry<object>);
        this.identities.add(identityKey, entry as unknown as EntityEntry<object>);
        this.trackedEntries.add(entry as unknown as EntityEntry<object>);
        const model = changeTrackerModel(this);
        if (model) {
            initializeNavigationSnapshots(
                entry as unknown as EntityEntry<object>,
                model,
            );
        }
        this.onTracked?.(entity);
        return entry;
    }

    public entry<TEntity extends object>(entity: TEntity): EntityEntry<TEntity> | undefined {
        return this.entriesByEntity.get(entity) as unknown as EntityEntry<TEntity> | undefined;
    }

    public tryGetByIdentity<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        keyValue: unknown,
    ): EntityEntry<TEntity> | undefined {
        return this.tryGetByIdentityValues(metadata, [keyValue]);
    }

    /** Look up a tracked entry by its key values, in declaration order. */
    public tryGetByIdentityValues<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        keyValues: readonly unknown[],
    ): EntityEntry<TEntity> | undefined {
        return this.identities.get(metadata.createIdentityKeyFromValues(keyValues)) as unknown as EntityEntry<TEntity> | undefined;
    }

    public entries(): ReadonlyArray<EntityEntry<object>> {
        return Array.from(this.trackedEntries);
    }

    public detach<TEntity extends object>(entity: TEntity): EntityEntry<TEntity> | undefined {
        const entry = this.entriesByEntity.get(entity) as unknown as EntityEntry<TEntity> | undefined;
        if (!entry) {
            return undefined;
        }

        entry.markDetached();
        this.entriesByEntity.delete(entity);
        this.identities.remove(entry as unknown as EntityEntry<object>);
        this.trackedEntries.delete(entry as unknown as EntityEntry<object>);
        return entry;
    }

    public detectChanges(): void {
        const configuredModel = changeTrackerModel(this);
        if (configuredModel) {
            detectRelationshipChanges(this, configuredModel);
        }
        for (const entry of this.trackedEntries) {
            entry.detectChanges();
        }
    }
    public acceptAllChanges(): void {
        this.acceptance.acceptAll();
    }

    /** Accept only the entries and values represented by an executed plan. */
    public acceptPersistedChanges(
        snapshots: readonly PersistedEntrySnapshot[],
    ): () => void {
        return this.acceptance.acceptPersisted(snapshots);
    }
    public clear(): void {
        for (const entry of this.trackedEntries) {
            entry.markDetached();
        }
        this.entriesByEntity = new WeakMap<object, EntityEntry<object>>();
        this.identities.clear();
        this.trackedEntries.clear();
    }

    public debugView(): string {
        this.detectChanges();
        return formatChangeTracker(this.entries());
    }
}
