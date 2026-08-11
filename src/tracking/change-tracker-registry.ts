import type { EntityMetadata } from '../model/entity-metadata';
import type { ChangeTracker } from './change-tracker';
import { changeTrackerModel } from './change-tracker-model';
import type { EntityEntry } from './entity-entry';
import { cloneEntityValues, readEntityValues } from './entity-entry-snapshot';
import type { EntityState } from './entity-state';
import { initializeNavigationSnapshots } from './navigation-snapshot';
import { TrackedIdentityMap } from './tracked-identity-map';
import { TrackingIdentityFactory } from './tracking-identity-factory';
import { assertTrackingIdentityRegistration, clearTemporaryGeneratedIdentity } from './temporary-generated-identity';
import { reuseTrackedEntry } from './tracked-entry-reuse';
import { trackingCollisionError } from './tracking-collision-error';
import { captureTrackedBoundEntityValues, cloneBoundValues } from './bound-value-snapshot';
import { createTrackedEntry } from './tracked-entry-factory';

export class ChangeTrackerRegistry {
    private entriesByEntity: WeakMap<object, EntityEntry<object>> = new WeakMap();
    private readonly trackedEntries: Set<EntityEntry<object>> = new Set();
    private readonly identityFactory = new TrackingIdentityFactory();
    public readonly identities = new TrackedIdentityMap();
    constructor(
        private readonly owner: ChangeTracker,
        private readonly assertMutation: (
            operation: string,
            entity: object,
            identityKey?: string,
        ) => void,
        private readonly notifyTracked: (entity: object) => void,
    ) {}

    public track<TEntity extends object>(
        entity: TEntity,
        metadata: EntityMetadata<TEntity>,
        state: EntityState,
        originalValues?: Record<string, unknown>,
        originalBoundValues?: Record<string, unknown>,
    ): EntityEntry<TEntity> {
        metadata.assertWritable('Tracking');
        this.assertMutation('Tracking an entity', entity);
        const existingByObject = this.entriesByEntity.get(entity);
        if (existingByObject) {
            const registeredIdentity = this.identities.keyFor(existingByObject);
            this.assertMutation(
                'Tracking an entity',
                entity,
                registeredIdentity,
            );
            reuseTrackedEntry(existingByObject, state);
            this.assertInvariant();
            return existingByObject as unknown as EntityEntry<TEntity>;
        }
        const capturedValues = originalValues
            ? cloneEntityValues(metadata, originalValues)
            : readEntityValues(metadata, entity);
        const capturedBoundValues = originalBoundValues
            ? cloneBoundValues(originalBoundValues)
            : captureTrackedBoundEntityValues(metadata, capturedValues);
        const identity = this.identityFactory.createFromValues(
            metadata,
            state,
            capturedValues,
            capturedBoundValues,
        );
        const { identityKey } = identity;
        this.assertMutation('Tracking an entity', entity, identityKey);
        const existingByIdentity = this.identities.get(identityKey);
        if (existingByIdentity) {
            throw trackingCollisionError(metadata, capturedValues, state);
        }

        const entry = createTrackedEntry(
            this.owner,
            entity,
            metadata,
            state,
            capturedValues,
            capturedBoundValues,
            identity.temporaryGeneratedIdentity,
            () => {
                this.assertMutation('Changing EntityEntry.state', entity);
            },
        );
        this.entriesByEntity.set(entity, entry as unknown as EntityEntry<object>);
        this.identities.add(identityKey, entry as unknown as EntityEntry<object>);
        this.trackedEntries.add(entry as unknown as EntityEntry<object>);
        const model = changeTrackerModel(this.owner);
        if (model) {
            initializeNavigationSnapshots(
                entry as unknown as EntityEntry<object>,
                model,
            );
        }
        this.notifyTracked(entity);
        this.assertInvariant();
        return entry;
    }

    public entry<TEntity extends object>(entity: TEntity): EntityEntry<TEntity> | undefined {
        return this.entriesByEntity.get(entity) as unknown as EntityEntry<TEntity> | undefined;
    }

    public entries(): ReadonlyArray<EntityEntry<object>> {
        return Array.from(this.trackedEntries);
    }

    public has(entry: EntityEntry<object>): boolean {
        return this.trackedEntries.has(entry);
    }

    public detach<TEntity extends object>(entity: TEntity): EntityEntry<TEntity> | undefined {
        const entry = this.entry(entity);
        if (!entry) return undefined;
        entry.markDetached();
        clearTemporaryGeneratedIdentity(
            entry as unknown as EntityEntry<object>,
        );
        this.entriesByEntity.delete(entity);
        this.identities.remove(entry as unknown as EntityEntry<object>);
        this.trackedEntries.delete(entry as unknown as EntityEntry<object>);
        this.assertInvariant();
        return entry;
    }

    public restore(entry: EntityEntry<object>): void {
        this.entriesByEntity.set(entry.entity, entry);
        this.trackedEntries.add(entry);
    }

    public clear(): void {
        for (const entry of this.trackedEntries) {
            entry.markDetached();
            clearTemporaryGeneratedIdentity(entry);
        }
        this.entriesByEntity = new WeakMap<object, EntityEntry<object>>();
        this.identities.clear();
        this.trackedEntries.clear();
        this.assertInvariant();
    }

    public assertInvariant(): void {
        this.identities.assertConsistent(this.trackedEntries);
        for (const entry of this.trackedEntries) {
            assertTrackingIdentityRegistration(
                entry,
                this.identities.keyFor(entry),
            );
        }
    }
}
