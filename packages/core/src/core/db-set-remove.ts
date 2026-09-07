import type { EntityMetadata } from '../model/entity-metadata';
import type { EntityEntry } from '../tracking/entity-entry-types';
import { EntityState } from '../tracking/entity-state';
import { publicEntityEntry } from '../tracking/public-entity-entry';
import type { DbSetContext } from './db-set-context';

/** Mark an entity deleted, or cancel its pending insertion. */
export function removeDbSetEntity<TEntity extends object>(
    context: DbSetContext,
    metadata: EntityMetadata<TEntity>,
    entity: TEntity,
    cancelAddedEntity: (entity: object) => void,
): EntityEntry<TEntity> {
    context.assertStateUsable?.('remove()');
    metadata.assertWritable('remove()');
    const entry = context.changeTracker.entry(entity) ?? context.changeTracker.track(
        entity, metadata, EntityState.Unchanged,
    );
    if (entry.state === EntityState.Added) {
        cancelAddedEntity(entity);
        return publicEntityEntry(entry, context);
    }
    entry.markDeleted();
    return publicEntityEntry(entry, context);
}
