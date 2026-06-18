import type { EntityMetadata } from '../../model/entity-metadata';
import type { PropertyMetadata } from '../../model/property-metadata';
import { toProviderValue } from '../../model/value-converter/store-value';
import { readPropertyValue } from '../../model/property-value-access';
import type { SqlDialect } from '../../sql/sql-dialect';
import { SqlParameterBag, type SqlStatement } from '../../sql/sql-statement';

/** Build the keyed refresh used by providers without DML `returning`. */
export function buildGeneratedValueRefresh(
    dialect: SqlDialect,
    metadata: EntityMetadata,
    properties: readonly PropertyMetadata[],
    entity: object,
): SqlStatement {
    const parameters = new SqlParameterBag(dialect);
    const conditions = metadata.keyPropertiesMetadata.map(property => {
        const value = readPropertyValue(entity, property);
        if (value === undefined || value === null || value === '') {
            throw new Error(
                `Cannot refresh database-generated values for '${metadata.entityName}' because key property '${property.propertyName}' is empty.`,
            );
        }
        return `${dialect.quoteIdentifier(property.columnName)} = ${
            parameters.add(toProviderValue(value, property.converter as never))
        }`;
    });
    return {
        text: `select ${properties.map(property =>
            dialect.quoteIdentifier(property.columnName)).join(', ')} from ${
            dialect.quoteQualifiedIdentifier(metadata.schemaName, metadata.tableName)
        } where ${conditions.join(' and ')}`,
        values: parameters.values,
    };
}
