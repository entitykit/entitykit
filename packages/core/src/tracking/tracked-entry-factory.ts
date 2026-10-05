import type { EntityMetadata } from '../model/entity-metadata';
import type { ChangeTracker } from './change-tracker';
import { configureTrackedEntry } from './change-tracker-model';
import { EntityEntry } from './entity-entry';
import type { EntityState } from './entity-state';
import type { InitialTrackedEntrySnapshot } from './initial-tracked-entry-snapshot';
import {
    registerTemporaryGeneratedIdentity,
    type TemporaryGeneratedIdentity,
} from './temporary-generated-identity';

export function createTrackedEntry<TEntity extends object>(
    owner: ChangeTracker,
    entity: TEntity,
    metadata: EntityMetadata<TEntity>,
    state: EntityState,
    ownedSnapshot: InitialTrackedEntrySnapshot,
    temporaryIdentity: TemporaryGeneratedIdentity | undefined,
    assertStateMutation: () => void,
): EntityEntry<TEntity> {
    // Registration already owns these defensive snapshots. Direct entry
    // construction still captures caller-owned values before retaining them.
    const entry = new EntityEntry(
        entity,
        metadata,
        state,
        undefined,
        undefined,
        ownedSnapshot,
    );
    registerTemporaryGeneratedIdentity(
        entry as unknown as EntityEntry<object>,
        temporaryIdentity,
    );
    configureTrackedEntry(
        owner,
        entry as unknown as EntityEntry<object>,
        assertStateMutation,
    );
    return entry;
}
