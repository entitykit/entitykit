import type { EntityMetadata } from '../model/entity-metadata';
import { readPropertyValue } from '../model/property-value-access';
import { toBoundPropertyValue } from '../model/value-converter/store-value';
import { validateRequiredProperties } from './modification-sql-helpers';
import type { SqlDialect } from './sql-dialect';
import { SqlParameterBag, type SqlStatement } from './sql-statement';
import {
    buildEntityInsert,
    buildEntityInsertFromValues,
} from './entity-insert-sql';
import { validateRequiredPropertyValues } from './modification-sql-helpers';

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
            .map(property => parameters.add(toBoundPropertyValue(
                readPropertyValue(entity, property),
                property,
                metadata.entityName,
            )))
            .join(', ');
        return `(${values})`;
    });

    return {
        text: `insert into ${dialect.quoteQualifiedIdentifier(metadata.schemaName, metadata.tableName)} (${columns}) values ${rows.join(', ')}`,
        values: parameters.values,
    };
}

export function buildEntityInsertBatchFromValues<TEntity extends object>(
    dialect: SqlDialect,
    metadata: EntityMetadata<TEntity>,
    rows: ReadonlyArray<Readonly<Record<string, unknown>>>,
): SqlStatement {
    if (rows.length === 0) {
        throw new Error('At least one entity is required.');
    }
    if (rows.length === 1) {
        return buildEntityInsertFromValues(
            dialect,
            metadata,
            rows[0],
        );
    }

    const parameters = new SqlParameterBag(dialect);
    const columns = metadata.properties
        .map(property => dialect.quoteIdentifier(property.columnName))
        .join(', ');
    const values = rows.map(row => {
        validateRequiredPropertyValues(metadata, row, { forInsert: true });
        return `(${metadata.properties.map(property => parameters.add(
            toBoundPropertyValue(
                row[property.propertyName],
                property,
                metadata.entityName,
            ),
        )).join(', ')})`;
    });

    return {
        text: `insert into ${dialect.quoteQualifiedIdentifier(metadata.schemaName, metadata.tableName)} (${columns}) values ${values.join(', ')}`,
        values: parameters.values,
    };
}
