import type { EntityMetadata } from '../model/entity-metadata';
import type { PropertyMetadata } from '../model/property-metadata';
import { assertSoftDeletePersistedValue } from '../model/soft-delete-metadata-validation';
import { isGeneratedOnUpdate } from '../model/value-generated';
import {
    buildKeyAndConcurrencyWhereFromValues,
    capturedBoundPropertyValue,
    validateRequiredPropertyValues,
} from './captured-value-sql-helpers';
import type { SqlDialect } from './sql-dialect';
import { SqlParameterBag, type SqlStatement } from './sql-statement';

export function buildCapturedEntityUpdate<TEntity extends object>(
    dialect: SqlDialect,
    metadata: EntityMetadata<TEntity>,
    values: Readonly<Record<string, unknown>>,
    modifiedProperties: readonly string[],
    originalValues: Readonly<Record<string, unknown>> = {},
    boundValues?: Readonly<Record<string, unknown>>,
    originalBoundValues?: Readonly<Record<string, unknown>>,
): SqlStatement | undefined {
    validateRequiredPropertyValues(metadata, values);
    const versionProperties = metadata.properties.filter(property =>
        property.isVersion);
    const keyProperties: Set<string> = new Set(metadata.keyProperties);
    const writableProperties = modifiedProperties
        .filter(propertyName => !keyProperties.has(propertyName))
        .map(propertyName => metadata.getProperty(propertyName as never))
        .filter(property =>
            !property.isVersion &&
            !isGeneratedOnUpdate(property.valueGenerated),
        );
    if (writableProperties.length === 0 && versionProperties.length === 0) {
        return undefined;
    }

    const parameters = new SqlParameterBag(dialect);
    const assignments = [
        ...writableProperties.map(property =>
            `${dialect.quoteIdentifier(property.columnName)} = ${parameters.add(boundUpdateValue(metadata, property, values, boundValues))}`),
        ...versionProperties.map(property =>
            `${dialect.quoteIdentifier(property.columnName)} = ${dialect.quoteIdentifier(property.columnName)} + 1`),
    ].join(', ');
    const where = buildKeyAndConcurrencyWhereFromValues(
        dialect,
        metadata,
        values,
        originalValues,
        parameters,
        boundValues,
        originalBoundValues,
    );
    const generatedProperties = metadata.properties.filter(property =>
        isGeneratedOnUpdate(property.valueGenerated));
    const returning = generatedProperties.length > 0
        ? dialect.returningClause?.(
            generatedProperties.map(property => property.columnName),
        )
        : undefined;
    return {
        text: `update ${dialect.quoteQualifiedIdentifier(metadata.schemaName, metadata.tableName)} set ${assignments} where ${where}${returning ? ` ${returning}` : ''}`,
        values: parameters.values,
    };
}

function boundUpdateValue<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    property: PropertyMetadata<TEntity>,
    values: Readonly<Record<string, unknown>>,
    boundValues?: Readonly<Record<string, unknown>>,
): unknown {
    const bound = capturedBoundPropertyValue(
        metadata,
        property,
        values,
        boundValues,
    );
    if (property.propertyName === metadata.softDelete?.propertyName) {
        assertSoftDeletePersistedValue(
            metadata.entityName,
            property.propertyName,
            bound,
        );
    }
    return bound;
}
