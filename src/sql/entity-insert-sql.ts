import type { EntityMetadata } from '../model/entity-metadata';
import { toBoundPropertyValue } from '../model/value-converter/store-value';
import {
    validateRequiredProperties,
    validateRequiredPropertyValues,
} from './modification-sql-helpers';
import type { SqlDialect } from './sql-dialect';
import { SqlParameterBag, type SqlStatement } from './sql-statement';
import { isGeneratedOnAdd } from '../model/value-generated';
import { readPropertyValue } from '../model/property-value-access';
import type { PropertyMetadata } from '../model/property-metadata';

export function buildEntityInsert<TEntity extends object>(
    dialect: SqlDialect,
    metadata: EntityMetadata<TEntity>,
    entity: TEntity,
    allowMissingProperties: readonly string[] = [],
): SqlStatement {
    validateRequiredProperties(metadata, entity, {
        forInsert: true,
        allowMissingProperties,
    });

    return buildEntityInsertFromReader(
        dialect,
        metadata,
        property => readPropertyValue(entity, property),
    );
}

/** Build an insert from the immutable values captured by a save plan. */
export function buildEntityInsertFromValues<TEntity extends object>(
    dialect: SqlDialect,
    metadata: EntityMetadata<TEntity>,
    valuesByProperty: Readonly<Record<string, unknown>>,
    allowMissingProperties: readonly string[] = [],
): SqlStatement {
    validateRequiredPropertyValues(metadata, valuesByProperty, {
        forInsert: true,
        allowMissingProperties,
    });

    return buildEntityInsertFromReader(
        dialect,
        metadata,
        property => valuesByProperty[property.propertyName],
    );
}

function buildEntityInsertFromReader<TEntity extends object>(
    dialect: SqlDialect,
    metadata: EntityMetadata<TEntity>,
    readValue: (property: PropertyMetadata<TEntity>) => unknown,
): SqlStatement {

    const parameters = new SqlParameterBag(dialect);
    const writeProperties = metadata.properties.filter(
        property => !isGeneratedOnAdd(property.valueGenerated),
    );
    const generatedProperties = metadata.properties.filter(
        property => isGeneratedOnAdd(property.valueGenerated),
    );
    const columns = writeProperties
        .map(property => dialect.quoteIdentifier(property.columnName))
        .join(', ');
    const values = writeProperties
        .map(property => parameters.add(toBoundPropertyValue(
            readValue(property),
            property,
            metadata.entityName,
        )))
        .join(', ');

    const insertBody = writeProperties.length === 0
        ? dialect.defaultValuesInsertClause?.() ?? 'default values'
        : `(${columns}) values (${values})`;
    const returning = generatedProperties.length > 0
        ? dialect.returningClause?.(
            generatedProperties.map(property => property.columnName),
        )
        : undefined;

    return {
        text: `insert into ${dialect.quoteQualifiedIdentifier(metadata.schemaName, metadata.tableName)} ${insertBody}${returning ? ` ${returning}` : ''}`,
        values: parameters.values,
    };
}
