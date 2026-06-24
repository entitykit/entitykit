import type { EntityMetadata } from '../model/entity-metadata';
import { formatTrackedEntry } from './change-tracker-debug';
import { EntityEntry } from './entity-entry';
import { EntityState } from './entity-state';
import { TrackedIdentityMap } from './tracked-identity-map';
import { TrackingIdentityFactory } from './tracking-identity-factory';
import { changeTrackerModel, configureTrackedEntry } from './change-tracker-model';
import { initializeNavigationSnapshots } from './navigation-snapshot';
import { detectRelationshipChanges } from './relationship-change-detector';

export class ChangeTracker {
    private entriesByEntity: WeakMap<object, EntityEntry<object>> = new WeakMap();
    private readonly identities = new TrackedIdentityMap();
    private readonly trackedEntries: Set<EntityEntry<object>> = new Set();
    private readonly identityFactory = new TrackingIdentityFactory();
    private onTracked?: (entity: object) => void;

    /**
   * Observe entities as they become tracked.
   *
   * Every path that tracks an entity — query materialization, `add`, `attach` —
   * arrives here, so one hook covers them all. Used to attach the lazy loader.
   */
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
        const entries = Array.from(this.trackedEntries);
        this.identities.prepareAccept(entries);
        for (const entry of entries) {
            if (entry.state === EntityState.Deleted) {
                this.detach(entry.entity);
                continue;
            }

            entry.acceptChanges();
        }
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
        if (this.trackedEntries.size === 0) {
            return 'No tracked entities.';
        }

        return Array.from(this.trackedEntries)
            .map(formatTrackedEntry)
            .join('\n');
    }
}
