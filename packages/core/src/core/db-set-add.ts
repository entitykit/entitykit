import type { EntityMetadata } from '../model/entity-metadata';
import type { EntityEntry as InternalEntityEntry } from '../tracking/entity-entry';
import type { EntityEntry } from '../tracking/entity-entry-types';
import { EntityState } from '../tracking/entity-state';
import { publicEntityEntry } from '../tracking/public-entity-entry';
import type { DbSetContext } from './db-set-context';
import { applyTenantOnAdd } from './save-time-tenant';
import { RestorationScope } from '../restoration-scope';

/** Apply tenant defaults and track one new entity, rolling back on collision. */
export function addDbSetEntity<TEntity extends object>(
    context: DbSetContext,
    metadata: EntityMetadata<TEntity>,
    entity: TEntity,
): EntityEntry<TEntity> {
    context.assertStateUsable?.('add()');
    metadata.assertWritable('add()');
    const scope = new RestorationScope(error => {
        context.markStateRestorationFailure(error);
    });
    let rollbackTenant = (): void => undefined;
    let entry: InternalEntityEntry<TEntity> | undefined;
    try {
        rollbackTenant = applyTenantOnAdd(
            metadata,
            entity,
            () => context.currentTenantIdForWrites(),
            context.allowsCrossTenantAccess(),
            scope,
        );
        entry = context.changeTracker.track(entity, metadata, EntityState.Added);
    } catch (error) {
        scope.capturePrimary(error);
        scope.attempt(rollbackTenant);
        scope.rethrowPrimary();
    }
    if (!entry) throw new Error('Added entity was not tracked.');
    return publicEntityEntry(entry, context);
}
