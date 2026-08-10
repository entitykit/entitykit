import { DbValidationError } from '../errors/entity-kit-error';
import type { EntityMetadata } from '../model/entity-metadata';
import type { ChangeTracker } from '../tracking/change-tracker';

/** Reject input identities that cannot safely use the set-based upsert path. */
export function assertBulkUpsertInputs<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    changeTracker: ChangeTracker,
    entities: readonly TEntity[],
): void {
    const seen: Set<TEntity> = new Set();
    for (const entity of entities) {
        if (seen.has(entity)) {
            throw new DbValidationError(
                `Upsert input '${metadata.entityName}' appears more than once. Each input object must be unique.`,
            );
        }
        seen.add(entity);
        if (changeTracker.entry(entity)) {
            throw new DbValidationError(
                `Upsert input '${metadata.entityName}' is already tracked. Use saveChanges() for tracked entities or detach it before upsert.`,
            );
        }
    }
}
