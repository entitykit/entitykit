import type { EntityMetadata } from '../model/entity-metadata';
import type { EntityEntry as InternalEntityEntry } from '../tracking/entity-entry';
import type { EntityEntry } from '../tracking/entity-entry-types';
import { EntityState } from '../tracking/entity-state';
import { publicEntityEntry } from '../tracking/public-entity-entry';
import type { DbSetContext } from './db-set-context';
import { applyTenantOnAdd } from './save-time-tenant';

/** Apply tenant defaults and track one new entity, rolling back on collision. */
export function addDbSetEntity<TEntity extends object>(
    context: DbSetContext,
    metadata: EntityMetadata<TEntity>,
    entity: TEntity,
): EntityEntry<TEntity> {
    metadata.assertWritable('add()');
    const rollbackTenant = applyTenantOnAdd(
        metadata,
        entity,
        () => context.currentTenantIdForWrites(),
        context.allowsCrossTenantAccess(),
    );
    let entry: InternalEntityEntry<TEntity>;
    try {
        entry = context.changeTracker.track(entity, metadata, EntityState.Added);
    } catch (error) {
        rollbackTenant();
        throw error;
    }
    return publicEntityEntry(entry, context);
}
