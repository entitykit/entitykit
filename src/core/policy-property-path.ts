import { ensureComplexPropertyPath } from '../materialization/complex-value-materializer';
import type { EntityMetadata } from '../model/entity-metadata';
import type { PropertyMetadata } from '../model/property-metadata';
import type { SaveTimeMutationLog } from './save-time-mutations';

/** Construct complex ancestors for a framework-owned policy property. */
export function ensurePolicyPropertyPath<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    entity: object,
    property: PropertyMetadata,
    mutations?: SaveTimeMutationLog,
): void {
    ensureComplexPropertyPath(
        metadata,
        entity,
        property.propertyPath,
        mutations
            ? (target, propertyName) => {
                mutations.recordCaptured(
                    target,
                    propertyName,
                    target[propertyName],
                );
            }
            : undefined,
    );
}
