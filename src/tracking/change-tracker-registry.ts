import type { EntityMetadata } from '../model/entity-metadata';
import type { ChangeTracker } from './change-tracker';
import { changeTrackerModel } from './change-tracker-model';
import type { EntityEntry } from './entity-entry';
import type { EntityState } from './entity-state';
import { TrackedIdentityMap } from './tracked-identity-map';
import { TrackingIdentityFactory } from './tracking-identity-factory';
import { assertTrackingIdentityRegistration, clearTemporaryGeneratedIdentity } from './temporary-generated-identity';
import { reuseTrackedEntry } from './tracked-entry-reuse';
import { trackingCollisionError } from './tracking-collision-error';
import { createTrackedEntry } from './tracked-entry-factory';
import { prepareTrackedRegistration, publishTrackedRegistration } from './tracked-entry-registration';
import { registerRelationshipDetectionRegistry } from './change-tracker-relationship-detection-registry';

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
        private readonly notifyTracked: (
            entity: object,
        ) => (() => void) | undefined,
        notifyDetached: (entity: object) => (() => void) | undefined,
    ) {
        registerRelationshipDetectionRegistry(owner, this, notifyDetached);
    }
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
        const prepared = prepareTrackedRegistration(
            entity,
            metadata,
            state,
            this.identityFactory,
            originalValues,
            originalBoundValues,
        );
        const { values, boundValues, identity } = prepared;
        const { identityKey } = identity;
        this.assertMutation('Tracking an entity', entity, identityKey);
        const existingByIdentity = this.identities.get(identityKey);
        if (existingByIdentity) {
            throw trackingCollisionError(metadata, values, state);
        }

        const entry = createTrackedEntry(
            this.owner,
            entity,
            metadata,
            state,
            values,
            boundValues,
            identity.temporaryGeneratedIdentity,
            () => {
                this.assertMutation('Changing EntityEntry.state', entity);
            },
        );
        const tracked = entry as unknown as EntityEntry<object>;
        publishTrackedRegistration(
            entity,
            tracked,
            identityKey,
            changeTrackerModel(this.owner),
            this.entriesByEntity,
            this.identities,
            this.trackedEntries,
            () => this.notifyTracked(entity),
            () => {
                this.assertInvariant();
            },
        );
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
