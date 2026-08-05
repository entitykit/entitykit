import type { EntityMetadata } from '../model/entity-metadata';
import { readPropertyValue } from '../model/property-value-access';
import { toBoundPropertyValue } from '../model/value-converter/store-value';
import { validateRequiredProperties } from './modification-sql-helpers';
import type { SqlDialect } from './sql-dialect';
import { SqlParameterBag, type SqlStatement } from './sql-statement';
import { buildEntityInsert } from './entity-insert-sql';

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
