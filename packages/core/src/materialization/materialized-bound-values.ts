import type { EntityMetadata } from '../model/entity-metadata';
import { cloneBoundEntityValues } from '../tracking/bound-entity-value-clone';
import { cloneBoundValues } from '../tracking/bound-value-snapshot';

interface MaterializedPersistenceFacts {
    readonly boundValues: Record<string, unknown>;
    readonly cloneValues: () => Record<string, unknown>;
}

// Presence reserves an instance even before persistence facts are complete.
// Failed materialization must keep that reservation for the entity's lifetime.
const facts: WeakMap<object, MaterializedPersistenceFacts | undefined> = new WeakMap();

export function reserveMaterializedEntity(entity: object): boolean {
    if (facts.has(entity)) return false;
    facts.set(entity, undefined);
    return true;
}

export function rememberMaterializedPersistenceFacts<
    TEntity extends object,
>(
    entity: object,
    metadata: EntityMetadata<TEntity>,
    values: Record<string, unknown>,
    boundValues: Readonly<Record<string, unknown>>,
): void {
    const capturedBoundValues = cloneBoundValues(boundValues);
    const capturedValues = cloneBoundEntityValues(
        metadata,
        values,
        capturedBoundValues,
    );
    facts.set(entity, {
        boundValues: capturedBoundValues,
        cloneValues: () => cloneBoundEntityValues(
            metadata,
            capturedValues,
            capturedBoundValues,
        ),
    });
}

export function materializedPersistenceFacts(
    entity: object,
): {
    readonly values: Record<string, unknown>;
    readonly boundValues: Record<string, unknown>;
} | undefined {
    const stored = facts.get(entity);
    return stored ? {
        values: stored.cloneValues(),
        boundValues: cloneBoundValues(stored.boundValues),
    } : undefined;
}
