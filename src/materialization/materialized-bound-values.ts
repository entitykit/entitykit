import type { EntityMetadata } from '../model/entity-metadata';
import { cloneBoundEntityValues } from '../tracking/bound-entity-value-clone';
import { cloneBoundValues } from '../tracking/bound-value-snapshot';

interface MaterializedPersistenceFacts {
    readonly boundValues: Record<string, unknown>;
    readonly cloneValues: () => Record<string, unknown>;
}

const facts: WeakMap<object, MaterializedPersistenceFacts> = new WeakMap();

export function hasMaterializedPersistenceFacts(entity: object): boolean {
    return facts.has(entity);
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
