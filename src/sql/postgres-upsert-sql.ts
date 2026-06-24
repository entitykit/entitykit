import type { EntityMetadata } from '../model/entity-metadata';
import { toStoreValue } from '../model/value-converter/store-value';
import type { EntityPropertyKey } from '../types';
import { validateRequiredProperties } from './modification-sql-helpers';
import type { SqlDialect } from './sql-dialect';
import { SqlParameterBag, type SqlStatement } from './sql-statement';
import { resolveConfiguredProperties } from './upsert-property-selection';
import { readPropertyValue } from '../model/property-value-access';

export interface PostgresUpsertSqlOptions<TEntity extends object> {
    readonly conflictProperties?: ReadonlyArray<EntityPropertyKey<TEntity>>;
    readonly updateProperties?: ReadonlyArray<EntityPropertyKey<TEntity>>;
}

export function buildPostgresUpsert<TEntity extends object>(
    dialect: SqlDialect,
    metadata: EntityMetadata<TEntity>,
    entity: TEntity,
    options: PostgresUpsertSqlOptions<TEntity> = {},
): SqlStatement {
    if (dialect.name !== 'postgres') {
        throw new Error(
            'Postgres upsert statements require the postgres SQL dialect.',
        );
    }
    validateRequiredProperties(metadata, entity);

    const conflictProperties = resolveConfiguredProperties(
        metadata,
        options.conflictProperties ?? [metadata.keyProperty],
        'conflictProperties',
    );
    const conflictNames = new Set(
        conflictProperties.map(property => property.propertyName),
    );
    const updateProperties = options.updateProperties
        ? resolveConfiguredProperties(
            metadata,
            options.updateProperties,
            'updateProperties',
        )
        : metadata.properties.filter(property =>
            !property.isPrimaryKey && !conflictNames.has(property.propertyName),
        );

    if (updateProperties.length === 0) {
        throw new Error(
            'Postgres upsert statements must update at least one non-conflict property.',
        );
    }
    for (const property of updateProperties) {
        if (conflictNames.has(property.propertyName)) {
            throw new Error(
                `Postgres upsert updateProperties cannot include conflict property '${metadata.entityName}.${property.propertyName}'.`,
            );
        }
    }

    const parameters = new SqlParameterBag(dialect);
    const columns = metadata.properties
        .map(property => dialect.quoteIdentifier(property.columnName))
        .join(', ');
    const values = metadata.properties
        .map(property => parameters.add(toStoreValue(
            readPropertyValue(entity, property),
            property.columnType,
            property.converter as never,
        )))
        .join(', ');
    const conflictColumns = conflictProperties
        .map(property => dialect.quoteIdentifier(property.columnName))
        .join(', ');
    const assignments = updateProperties
        .map(property =>
            `${dialect.quoteIdentifier(property.columnName)} = excluded.${dialect.quoteIdentifier(property.columnName)}`,
        )
        .join(', ');

    return {
        text: `insert into ${dialect.quoteQualifiedIdentifier(metadata.schemaName, metadata.tableName)} (${columns}) values (${values}) on conflict (${conflictColumns}) do update set ${assignments}`,
        values: parameters.values,
    };
}
