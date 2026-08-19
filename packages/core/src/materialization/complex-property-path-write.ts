import { writeFailureAtomicPath } from '../failure-atomic-property-write';
import type { EntityMetadata } from '../model/entity-metadata';
import { readPropertyPath } from '../model/property-value-access';
import type { RestorationScope } from '../restoration-scope';
import { createComplexValue } from './complex-value-materializer';

/** Create missing complex ancestors through verified failure-atomic writes. */
export function ensureComplexPropertyPathFailureAtomic<
    TEntity extends object,
>(
    metadata: EntityMetadata<TEntity>,
    entity: object,
    propertyPath: readonly string[],
    restoration: RestorationScope,
): void {
    for (const complex of metadata.complexProperties) {
        if (!isAncestor(complex.propertyPath, propertyPath) ||
            readPropertyPath(entity, complex.propertyPath) != null) {
            continue;
        }
        writeFailureAtomicPath({
            entity,
            path: complex.propertyPath,
            value: createComplexValue(complex),
            scope: restoration,
            context: `${metadata.entityName}.${complex.propertyName}`,
        });
    }
}

function isAncestor(
    candidate: readonly string[],
    path: readonly string[],
): boolean {
    return candidate.length < path.length &&
        candidate.every((segment, index) => path[index] === segment);
}
