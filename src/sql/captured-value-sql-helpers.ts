import { DbValidationError } from '../errors/entity-kit-error';
import type { EntityMetadata } from '../model/entity-metadata';
import type { PropertyMetadata } from '../model/property-metadata';
import { toBoundPropertyValue } from '../model/value-converter/store-value';
import { isGeneratedOnAdd, isGeneratedOnUpdate } from '../model/value-generated';
import type { SqlDialect } from './sql-dialect';
import type { SqlParameterBag } from './sql-statement';

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

export function buildKeyAndConcurrencyWhereFromValues<
    TEntity extends object,
>(
    dialect: SqlDialect,
    metadata: EntityMetadata<TEntity>,
    values: Readonly<Record<string, unknown>>,
    originalValues: Readonly<Record<string, unknown>>,
    parameters: SqlParameterBag,
): string {
    const conditions = metadata.keyPropertiesMetadata.map(property =>
        compareCapturedProperty(
            dialect, property, values[property.propertyName], parameters,
            metadata.entityName,
        ));
    for (const property of metadata.properties.filter(item =>
        item.isConcurrencyToken)) {
        conditions.push(compareCapturedProperty(
            dialect, property, originalValues[property.propertyName],
            parameters, metadata.entityName,
        ));
    }
    return conditions.join(' and ');
}

function compareCapturedProperty<TEntity extends object>(
    dialect: SqlDialect,
    property: PropertyMetadata<TEntity>,
    value: unknown,
    parameters: SqlParameterBag,
    entityName: string,
): string {
    const column = dialect.quoteIdentifier(property.columnName);
    return value === null || value === undefined
        ? `${column} is null`
        : `${column} = ${parameters.add(toBoundPropertyValue(
            value, property, entityName,
        ))}`;
}
