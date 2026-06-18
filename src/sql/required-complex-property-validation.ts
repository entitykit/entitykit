import { DbValidationError } from '../errors/entity-kit-error';
import type { EntityMetadata } from '../model/entity-metadata';
import {
    hasPropertyPath,
    readPropertyPath,
} from '../model/property-value-access';

/** Enforce object-level requiredness for full or partial writes. */
export function validateRequiredComplexProperties<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    entity: object,
    partial = false,
): void {
    for (const complex of metadata.complexProperties) {
        if (!complex.isRequired) {
            continue;
        }
        if (partial && !hasPropertyPath(entity, complex.propertyPath)) {
            continue;
        }
        const value = readPropertyPath(entity, complex.propertyPath);
        if (value === null || value === undefined) {
            throw new DbValidationError(
                `Required complex property '${metadata.entityName}.${complex.propertyName}' must have a value.`,
            );
        }
    }
}
