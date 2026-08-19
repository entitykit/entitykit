import type { EntityMetadata } from '../../model/entity-metadata';
import type { EntityEntry } from '../../tracking/entity-entry';
import type { GeneratedIdentityRollbackSource } from '../../tracking/generated-identity-rollback-source';
import { cloneBoundValues } from '../../tracking/bound-value-snapshot';
import { cloneSnapshotValue } from '../../tracking/snapshot-value-clone';
import type { AppliedPropertyValue } from './applied-generated-value';

/** Build the exact generated identity fact before any live setter runs. */
export function generatedRollbackSource<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    entity: TEntity,
    generated: readonly AppliedPropertyValue[],
    sourceBoundValues: Readonly<Record<string, unknown>>,
    principal?: EntityEntry<object>,
): GeneratedIdentityRollbackSource {
    const boundValues = cloneBoundValues(sourceBoundValues);
    for (const value of generated) {
        boundValues[value.propertyName] = cloneSnapshotValue(
            value.boundValue,
        );
    }
    return {
        entity,
        entityType: metadata.ctor,
        keyProperties: metadata.keyProperties.map(String),
        tenantKeyProperty: metadata.tenantKeyProperty,
        principal,
        generatedProperties: new Set(generated.map(
            value => value.propertyName,
        )),
        boundValues,
    };
}
