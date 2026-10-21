import type { EntityMetadata } from '../model/entity-metadata';
import { cloneBoundEntityValues } from '../tracking/bound-entity-value-clone';
import { cloneBoundValues } from '../tracking/bound-value-snapshot';
import { compiledEntityPlan } from './compiled-entity-plan';
import { cloneUnconvertedEntityValues } from './compiled-entity-values';

interface MaterializedPersistenceFacts {
    readonly boundValues: Record<string, unknown>;
    readonly cloneValues: () => Record<string, unknown>;
}

class CapturedPersistenceFacts<TEntity extends object> implements MaterializedPersistenceFacts {
    constructor(
        private readonly metadata: EntityMetadata<TEntity>,
        private readonly values: Record<string, unknown>,
        public readonly boundValues: Record<string, unknown>,
    ) {}

    public cloneValues(): Record<string, unknown> {
        return cloneMaterializedValues(this.metadata, this.values, this.boundValues);
    }
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
    const capturedValues = cloneMaterializedValues(
        metadata,
        values,
        capturedBoundValues,
    );
    facts.set(entity, new CapturedPersistenceFacts(
        metadata,
        capturedValues,
        capturedBoundValues,
    ));
}

function cloneMaterializedValues<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    values: Record<string, unknown>,
    boundValues: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
    return compiledEntityPlan(metadata)
        ? cloneUnconvertedEntityValues(values)
        : cloneBoundEntityValues(metadata, values, boundValues);
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
