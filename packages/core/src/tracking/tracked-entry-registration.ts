import type { EntityMetadata } from '../model/entity-metadata';
import type { Model } from '../model/model';
import type { EntityEntry } from './entity-entry';
import type { EntityState } from './entity-state';
import {
    clearNavigationSnapshots,
} from './navigation-snapshot';
import { initializeNavigationSnapshots } from './navigation-snapshot-initialization';
import { clearTemporaryGeneratedIdentity } from './temporary-generated-identity';
import type { TrackedIdentityMap } from './tracked-identity-map';
import type {
    CapturedTrackingIdentity,
    TrackingIdentityFactory,
} from './tracking-identity-factory';
import { captureInitialTrackedEntrySnapshot } from './initial-tracked-entry-snapshot';
import { assertTrackedEntryRegistration } from './tracked-entry-registration-invariant';

export interface PreparedTrackedRegistration {
    readonly values: Record<string, unknown>;
    readonly boundValues: Record<string, unknown>;
    readonly identity: CapturedTrackingIdentity;
}

export function prepareTrackedRegistration<TEntity extends object>(
    entity: TEntity,
    metadata: EntityMetadata<TEntity>,
    state: EntityState,
    identityFactory: TrackingIdentityFactory,
    originalValues?: Record<string, unknown>,
    originalBoundValues?: Record<string, unknown>,
): PreparedTrackedRegistration {
    const { values, boundValues } = captureInitialTrackedEntrySnapshot(
        entity,
        metadata,
        originalValues,
        originalBoundValues,
    );
    return {
        values,
        boundValues,
        identity: identityFactory.createFromValues(
            metadata,
            state,
            values,
            boundValues,
        ),
    };
}

export function publishTrackedRegistration(
    entity: object,
    entry: EntityEntry<object>,
    identityKey: string,
    model: Model | undefined,
    entriesByEntity: WeakMap<object, EntityEntry<object>>,
    identities: TrackedIdentityMap,
    trackedEntries: Set<EntityEntry<object>>,
    notify: () => (() => void) | undefined,
): void {
    let cleanup: (() => void) | undefined;
    try {
        entriesByEntity.set(entity, entry);
        identities.add(identityKey, entry);
        trackedEntries.add(entry);
        if (model) initializeNavigationSnapshots(entry, model);
        cleanup = notify();
        assertTrackedEntryRegistration(
            entity,
            entry,
            entriesByEntity,
            identities,
            trackedEntries,
        );
    } catch (error) {
        cleanup?.();
        clearTemporaryGeneratedIdentity(entry);
        clearNavigationSnapshots(entry);
        entriesByEntity.delete(entity);
        identities.remove(entry);
        trackedEntries.delete(entry);
        entry.markDetached();
        throw error;
    }
}
