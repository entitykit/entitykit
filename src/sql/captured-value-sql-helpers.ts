import { DbValidationError } from '../errors/entity-kit-error';
import type { EntityMetadata } from '../model/entity-metadata';
import type { PropertyMetadata } from '../model/property-metadata';
import { toBoundPropertyValue } from '../model/value-converter/store-value';
import { isGeneratedOnAdd, isGeneratedOnUpdate } from '../model/value-generated';
import type { SqlDialect } from './sql-dialect';
import type { SqlParameterBag } from './sql-statement';
import { propertyComparisonParameter } from './property-comparison-parameter';

export function validateRequiredPropertyValues<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    values: Readonly<Record<string, unknown>>,
    options: {
        readonly forInsert?: boolean;
        readonly allowMissingProperties?: readonly string[];
    } = {},
): void {
    const allowedMissing = new Set(options.allowMissingProperties);
    for (const property of metadata.properties) {
        if (!property.isRequired ||
            options.forInsert && isGeneratedOnAdd(property.valueGenerated) ||
            !options.forInsert && isGeneratedOnUpdate(property.valueGenerated) ||
            allowedMissing.has(property.propertyName)) {
            continue;
        }
        if (values[property.propertyName] == null) {
            throw new DbValidationError(
                `Required property '${metadata.entityName}.${property.propertyName}' must have a value.`,
            );
        }
    }
}

/** Reuse an exact provider fact when save preparation captured one. */
export function capturedBoundPropertyValue<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    property: PropertyMetadata<TEntity>,
    values: Readonly<Record<string, unknown>>,
    boundValues?: Readonly<Record<string, unknown>>,
): unknown {
    return boundValues && Object.prototype.hasOwnProperty.call(
        boundValues,
        property.propertyName,
    )
        ? boundValues[property.propertyName]
        : toBoundPropertyValue(
            values[property.propertyName],
            property,
            metadata.entityName,
        );
}

export function buildKeyAndConcurrencyWhereFromValues<
    TEntity extends object,
>(
    dialect: SqlDialect,
    metadata: EntityMetadata<TEntity>,
    values: Readonly<Record<string, unknown>>,
    originalValues: Readonly<Record<string, unknown>>,
    parameters: SqlParameterBag,
    boundValues?: Readonly<Record<string, unknown>>,
    originalBoundValues?: Readonly<Record<string, unknown>>,
): string {
    const conditions = metadata.keyPropertiesMetadata.map(property =>
        compareCapturedProperty(
            dialect,
            property,
            capturedBoundPropertyValue(
                metadata,
                property,
                values,
                boundValues,
            ),
            parameters,
        ));
    for (const property of metadata.properties.filter(item =>
        item.isConcurrencyToken)) {
        conditions.push(compareCapturedProperty(
            dialect,
            property,
            capturedBoundPropertyValue(
                metadata,
                property,
                originalValues,
                originalBoundValues,
            ),
            parameters,
        ));
    }
    const tenantProperty = metadata.tenantKeyProperty;
    if (
        tenantProperty &&
        Object.prototype.hasOwnProperty.call(originalValues, tenantProperty) &&
        !metadata.keyProperties.includes(tenantProperty) &&
        !metadata.getProperty(tenantProperty).isConcurrencyToken
    ) {
        const property = metadata.getProperty(tenantProperty);
        conditions.push(compareCapturedProperty(
            dialect,
            property,
            capturedBoundPropertyValue(
                metadata,
                property,
                originalValues,
                originalBoundValues,
            ),
            parameters,
        ));
    }
    return conditions.join(' and ');
}

function compareCapturedProperty<TEntity extends object>(
    dialect: SqlDialect,
    property: PropertyMetadata<TEntity>,
    boundValue: unknown,
    parameters: SqlParameterBag,
): string {
    const column = dialect.quoteIdentifier(property.columnName);
    return boundValue === null || boundValue === undefined
        ? `${column} is null`
        : `${column} = ${propertyComparisonParameter(
            dialect,
            parameters,
            property,
            boundValue,
        )}`;
}
