import { ensureComplexPropertyPath } from '../materialization/complex-value-materializer';
import type { EntityMetadata } from '../model/entity-metadata';
import type { PropertyMetadata } from '../model/property-metadata';
import type { SaveTimeMutationLog } from './save-time-mutations';
import type { ComplexPropertyMetadata } from '../model/complex-property-metadata';
import { readPropertyPath, readPropertyValue } from '../model/property-value-access';
import {
    snapshotPropertyValue,
    snapshotPropertyValuesEqual,
} from '../tracking/snapshot-value';

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
            ? (target, propertyName, previous, created, complex) => {
                mutations.recordCreatedAncestor(
                    target,
                    propertyName,
                    previous,
                    created,
                    captureAncestorPristineCheck(
                        metadata,
                        entity,
                        complex,
                    ),
                );
            }
            : undefined,
    );
}

function captureAncestorPristineCheck<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    entity: object,
    complex: ComplexPropertyMetadata,
): () => boolean {
    const properties = metadata.properties
        .filter(property => isDescendant(complex.propertyPath, property.propertyPath))
        .map(property => ({
            property,
            value: snapshotPropertyValue(
                readPropertyValue(entity, property),
                property.converter,
                `${metadata.entityName}.${property.propertyName}`,
            ),
        }));
    const nested = metadata.complexProperties
        .filter(item => item !== complex && isDescendant(
            complex.propertyPath,
            item.propertyPath,
        ))
        .map(item => ({
            path: item.propertyPath,
            value: readPropertyPath(entity, item.propertyPath),
        }));
    return () => properties.every(({ property, value }) =>
        snapshotPropertyValuesEqual(
            readPropertyValue(entity, property),
            value,
            property.converter,
            `${metadata.entityName}.${property.propertyName}`,
        )) && nested.every(item =>
        readPropertyPath(entity, item.path) === item.value,
    );
}

function isDescendant(
    ancestor: readonly string[],
    path: readonly string[],
): boolean {
    return path.length > ancestor.length &&
        ancestor.every((segment, index) => path[index] === segment);
}
