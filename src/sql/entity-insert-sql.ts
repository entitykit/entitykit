import type { EntityMetadata } from '../model/entity-metadata';
import { toStoreValue } from '../model/value-converter/store-value';
import { validateRequiredProperties } from './modification-sql-helpers';
import type { SqlDialect } from './sql-dialect';
import { SqlParameterBag, type SqlStatement } from './sql-statement';
import { isGeneratedOnAdd } from '../model/value-generated';
import { readPropertyValue } from '../model/property-value-access';

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
        .map(property => parameters.add(toStoreValue(
            readPropertyValue(entity, property),
            property.columnType,
            property.converter as never,
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

export function buildEntityInsertBatch<TEntity extends object>(
    dialect: SqlDialect,
    metadata: EntityMetadata<TEntity>,
    entities: readonly TEntity[],
): SqlStatement {
    if (entities.length === 0) {
        throw new Error('At least one entity is required.');
    }
    if (entities.length === 1) {
        return buildEntityInsert(dialect, metadata, entities[0]);
    }

    const parameters = new SqlParameterBag(dialect);
    const columns = metadata.properties
        .map(property => dialect.quoteIdentifier(property.columnName))
        .join(', ');
    const rows = entities.map(entity => {
        validateRequiredProperties(metadata, entity, { forInsert: true });
        const values = metadata.properties
            .map(property => parameters.add(toStoreValue(
                readPropertyValue(entity, property),
                property.columnType,
                property.converter as never,
            )))
            .join(', ');
        return `(${values})`;
    });

    return {
        text: `insert into ${dialect.quoteQualifiedIdentifier(metadata.schemaName, metadata.tableName)} (${columns}) values ${rows.join(', ')}`,
        values: parameters.values,
    };
}
