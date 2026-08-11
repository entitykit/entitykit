import type { EntityMetadata } from '../model/entity-metadata';
import type { ChangeTracker } from './change-tracker';
import { configureTrackedEntry } from './change-tracker-model';
import { EntityEntry } from './entity-entry';
import type { EntityState } from './entity-state';
import {
    registerTemporaryGeneratedIdentity,
    type TemporaryGeneratedIdentity,
} from './temporary-generated-identity';

export function createTrackedEntry<TEntity extends object>(
    owner: ChangeTracker,
    entity: TEntity,
    metadata: EntityMetadata<TEntity>,
    state: EntityState,
    values: Record<string, unknown>,
    boundValues: Record<string, unknown>,
    temporaryIdentity: TemporaryGeneratedIdentity | undefined,
    assertStateMutation: () => void,
): EntityEntry<TEntity> {
    const entry = new EntityEntry(
        entity,
        metadata,
        state,
        values,
        boundValues,
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
