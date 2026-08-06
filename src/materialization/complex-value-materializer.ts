import type { EntityMetadata } from '../model/entity-metadata';
import {
    propertyValueTarget,
    readPropertyPath,
    writePropertyPath,
    writePropertyValue,
} from '../model/property-value-access';
import type { ComplexPropertyMetadata } from '../model/complex-property-metadata';

export function applyMaterializedValues<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    entity: TEntity,
    values: Readonly<Record<string, unknown>>,
): void {
    for (const complex of metadata.complexProperties) {
        const parent = complex.propertyPath.slice(0, -1);
        if (parent.length > 0 && readPropertyPath(entity, parent) === null) {
            continue;
        }
        const prefix = `${complex.propertyName}.`;
        const hasValue = metadata.properties.some(property =>
            property.propertyName.startsWith(prefix) &&
            values[property.propertyName] !== null &&
            values[property.propertyName] !== undefined);
        writePropertyPath(
            entity,
            complex.propertyPath,
            complex.isRequired || hasValue
                ? createComplexValue(complex)
                : null,
        );
    }

    for (const property of metadata.properties) {
        if (hasNullComplexAncestor(metadata, entity, property.propertyPath)) {
            continue;
        }
        writePropertyValue(entity, property, values[property.propertyName]);
    }
}

export function ensureComplexPropertyPath<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    entity: object,
    propertyPath: readonly string[],
    afterCreate?: (
        target: Record<string, unknown>,
        propertyName: string,
        previous: unknown,
        created: object,
        complex: ComplexPropertyMetadata,
    ) => void,
): void {
    for (const complex of metadata.complexProperties) {
        if (!isComplexAncestor(complex, propertyPath) ||
            readPropertyPath(entity, complex.propertyPath) != null) {
            continue;
        }
        const target = propertyValueTarget(entity, complex.propertyPath);
        const previous = target.target[target.propertyName];
        const created = createComplexValue(complex);
        writePropertyPath(
            entity,
            complex.propertyPath,
            created,
        );
        afterCreate?.(
            target.target,
            target.propertyName,
            previous,
            created,
            complex,
        );
    }
}

function createComplexValue(metadata: ComplexPropertyMetadata): object {
    if (!metadata.ctor) {
        return {};
    }
    const ctor = metadata.ctor as unknown as new () => object;
    return new ctor();
}

function hasNullComplexAncestor<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    entity: TEntity,
    propertyPath: readonly string[],
): boolean {
    return metadata.complexProperties.some(complex =>
        complex.propertyPath.length < propertyPath.length &&
        isPrefix(complex.propertyPath, propertyPath) &&
        readPropertyPath(entity, complex.propertyPath) === null);
}

function isPrefix(
    prefix: readonly string[],
    path: readonly string[],
): boolean {
    return prefix.every((segment, index) => path[index] === segment);
}

function isComplexAncestor(
    complex: ComplexPropertyMetadata,
    path: readonly string[],
): boolean {
    return complex.propertyPath.length < path.length &&
        isPrefix(complex.propertyPath, path);
}
