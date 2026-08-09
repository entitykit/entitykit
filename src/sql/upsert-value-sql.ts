import type { EntityMetadata } from '../model/entity-metadata';
import type { PropertyMetadata } from '../model/property-metadata';
import { toBoundPropertyValue } from '../model/value-converter/store-value';
import { validateRequiredPropertyValues } from './captured-value-sql-helpers';
import type { SqlDialect } from './sql-dialect';
import type { SqlParameterBag } from './sql-statement';
import {
    upsertGeneratedProperties,
    upsertInsertProperties,
} from './upsert-generated-properties';

interface UpsertWriteShape<TEntity extends object> {
    readonly insertProperties: Array<PropertyMetadata<TEntity>>;
    readonly returning: string;
}

export function resolveUpsertWriteShape<TEntity extends object>(
    dialect: SqlDialect,
    metadata: EntityMetadata<TEntity>,
    rowCount: number,
): UpsertWriteShape<TEntity> {
    const insertProperties = upsertInsertProperties(metadata);
    const generatedProperties = upsertGeneratedProperties(metadata);
    if (generatedProperties.length > 0 && rowCount !== 1) {
        throw new Error(
            `Upsert for '${metadata.entityName}' must execute one row at a time to correlate store-generated values.`,
        );
    }
    const returningClause = generatedProperties.length > 0
        ? dialect.returningClause?.(generatedProperties.map(
            property => property.columnName,
        ))
        : undefined;
    if (generatedProperties.length > 0 && !returningClause) {
        throw new Error(
            `The '${dialect.name}' dialect cannot safely upsert store-generated properties on '${metadata.entityName}' because it cannot return their persisted values.`,
        );
    }
    return {
        insertProperties,
        returning: returningClause ? ` ${returningClause}` : '',
    };
}

export function buildUpsertValueRows<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    rows: ReadonlyArray<Readonly<Record<string, unknown>>>,
    properties: ReadonlyArray<PropertyMetadata<TEntity>>,
    parameters: SqlParameterBag,
): string {
    return rows.map(values => {
        validateRequiredPropertyValues(metadata, values, { forInsert: true });
        const sql = properties.map(property => parameters.add(
            toBoundPropertyValue(
                values[property.propertyName],
                property,
                metadata.entityName,
            ),
        )).join(', ');
        return `(${sql})`;
    }).join(', ');
}
