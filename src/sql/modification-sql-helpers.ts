import type { EntityMetadata } from '../model/entity-metadata';
import type { PropertyMetadata } from '../model/property-metadata';
import type { ManyToManyMetadata } from '../model/many-to-many-metadata';
import { toBoundPropertyValue } from '../model/value-converter/store-value';
import { DbValidationError } from '../errors/entity-kit-error';
import type { SqlParameterBag } from './sql-statement';
import type { SqlDialect } from './sql-dialect';
import {
    isGeneratedOnAdd,
    isGeneratedOnUpdate,
} from '../model/value-generated';
import { readPropertyValue } from '../model/property-value-access';
import { validateRequiredComplexProperties } from './required-complex-property-validation';

/**
 * Fragment helpers shared across the DML strategy builders (insert, update,
 * delete, upsert). These are the pieces more than one operation needs — row
 * validation, the primary-key + optimistic-concurrency `where` clause, provider
 * gating, and many-to-many key flattening. Kept in one module so no single
 * operation builder owns code another depends on, and so the parameter-binding
 * order inside each shared fragment is defined exactly once.
 */

/**
 * One key value, or a tuple of them when the endpoint entity has a composite
 * key. Values are ordered to match that entity's key properties.
 */
export type ManyToManyEndpointKey = unknown;

export function validateRequiredProperties<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    entity: TEntity,
    options: {
        readonly forInsert?: boolean;
        readonly allowMissingProperties?: readonly string[];
    } = {},
): void {
    const allowedMissing = new Set(options.allowMissingProperties);
    validateRequiredComplexProperties(metadata, entity);

    for (const property of metadata.properties) {
        if (!property.isRequired) {
            continue;
        }
        if (options.forInsert && isGeneratedOnAdd(property.valueGenerated)) {
            continue;
        }
        if (!options.forInsert && isGeneratedOnUpdate(property.valueGenerated)) {
            continue;
        }
        if (allowedMissing.has(property.propertyName)) {
            continue;
        }

        const value = readPropertyValue(entity, property);
        if (value === undefined || value === null) {
            throw new DbValidationError(`Required property '${metadata.entityName}.${property.propertyName}' must have a value.`);
        }
    }
}

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
        if (!property.isRequired) {
            continue;
        }
        if (options.forInsert && isGeneratedOnAdd(property.valueGenerated)) {
            continue;
        }
        if (!options.forInsert && isGeneratedOnUpdate(property.valueGenerated)) {
            continue;
        }
        if (allowedMissing.has(property.propertyName)) {
            continue;
        }
        if (values[property.propertyName] == null) {
            throw new DbValidationError(
                `Required property '${metadata.entityName}.${property.propertyName}' must have a value.`,
            );
        }
    }
}

/**
 * The `where` clause that targets a single entity row: every key column, plus a
 * comparison per concurrency token against its original value. Callers pass a
 * live parameter bag so the bound values land in the same order as the SQL text
 * — key values first (in key-property order), then concurrency tokens.
 */
export function buildKeyAndConcurrencyWhere<TEntity extends object>(
    dialect: SqlDialect,
    metadata: EntityMetadata<TEntity>,
    entity: TEntity,
    originalValues: Readonly<Record<string, unknown>>,
    parameters: SqlParameterBag,
): string {
    const keyValues = metadata.getKeyValues(entity);
    const conditions = metadata.keyPropertiesMetadata.map((keyProperty, index) =>
        compareProperty(
            dialect, keyProperty, keyValues[index], parameters, metadata.entityName,
        ));

    for (const property of metadata.properties.filter(item => item.isConcurrencyToken)) {
        conditions.push(compareProperty(
            dialect,
            property,
            originalValues[property.propertyName],
            parameters,
            metadata.entityName,
        ));
    }

    return conditions.join(' and ');
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
    const conditions = metadata.keyPropertiesMetadata.map(keyProperty =>
        compareProperty(
            dialect,
            keyProperty,
            values[keyProperty.propertyName],
            parameters,
            metadata.entityName,
        ));

    for (const property of metadata.properties.filter(item =>
        item.isConcurrencyToken)) {
        conditions.push(compareProperty(
            dialect,
            property,
            originalValues[property.propertyName],
            parameters,
            metadata.entityName,
        ));
    }

    return conditions.join(' and ');
}

function compareProperty<TEntity extends object>(
    dialect: SqlDialect,
    property: PropertyMetadata<TEntity>,
    value: unknown,
    parameters: SqlParameterBag,
    entityName: string,
): string {
    const column = dialect.quoteIdentifier(property.columnName);
    if (value === null || value === undefined) {
        return `${column} is null`;
    }

    return `${column} = ${parameters.add(toBoundPropertyValue(value, property, entityName))}`;
}

export function requirePostgres(dialect: SqlDialect, message: string): void {
    if (dialect.name !== 'postgres') {
        throw new Error(message);
    }
}

/**
 * Flatten a many-to-many pair into the join table's column order, checking that
 * each side supplies one value per column.
 */
export function joinEndpointValues<TEntity extends object>(
    relationship: ManyToManyMetadata<TEntity>,
    sourceKeyValues: ManyToManyEndpointKey,
    targetKeyValues: ManyToManyEndpointKey,
): unknown[] {
    const source = toEndpointValues(sourceKeyValues, relationship.sourceForeignKeyColumns, relationship, 'source');
    const target = toEndpointValues(targetKeyValues, relationship.targetForeignKeyColumns, relationship, 'target');
    return [...source, ...target];
}

function toEndpointValues<TEntity extends object>(
    keyValues: ManyToManyEndpointKey,
    columns: readonly string[],
    relationship: ManyToManyMetadata<TEntity>,
    side: 'source' | 'target',
): unknown[] {
    const values = columns.length === 1 && !Array.isArray(keyValues) ? [keyValues] : [...(keyValues as unknown[])];
    if (values.length !== columns.length) {
        throw new Error(
            `Many-to-many join table '${relationship.joinTableName}' expects ${String(columns.length)} ${side} key value(s) for (${columns.join(', ')}), but received ${String(values.length)}.`,
        );
    }

    return values;
}
