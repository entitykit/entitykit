import type { EntityMetadata } from '../model/entity-metadata';
import { toBoundPropertyValue } from '../model/value-converter/store-value';
import type { EntityPropertyKey } from '../types';
import { validateRequiredPropertyValues } from './captured-value-sql-helpers';
import type { SqlDialect } from './sql-dialect';
import { SqlParameterBag, type SqlStatement } from './sql-statement';
import {
    assertResolvableUpsertConflict,
    defaultUpsertUpdateProperties,
    isStoreGenerated,
    resolveConfiguredProperties,
    upsertGeneratedProperties,
    upsertInsertProperties,
} from './upsert-property-selection';
import { readEntityValues } from '../tracking/entity-entry-snapshot';
import { validateRequiredComplexProperties } from './required-complex-property-validation';

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
    validateRequiredComplexProperties(metadata, entity);
    const valuesByProperty = readEntityValues(metadata, entity);
    validateRequiredPropertyValues(metadata, valuesByProperty, {
        forInsert: true,
    });

    const conflictProperties = resolveConfiguredProperties(
        metadata,
        options.conflictProperties ?? [metadata.keyProperty],
        'conflictProperties',
    );
    const conflictNames = new Set(
        conflictProperties.map(property => property.propertyName),
    );
    assertResolvableUpsertConflict(metadata, conflictProperties);
    const updateProperties = options.updateProperties
        ? resolveConfiguredProperties(
            metadata,
            options.updateProperties,
            'updateProperties',
        )
        : defaultUpsertUpdateProperties(metadata, conflictNames);

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
        if (property.propertyName === metadata.tenantKeyProperty) {
            throw new Error(
                `Postgres upsert updateProperties cannot include tenant property '${metadata.entityName}.${property.propertyName}'.`,
            );
        }
        if (isStoreGenerated(property)) {
            throw new Error(
                `Postgres upsert updateProperties cannot include store-generated property '${metadata.entityName}.${property.propertyName}'.`,
            );
        }
    }

    const parameters = new SqlParameterBag(dialect);
    const insertProperties = upsertInsertProperties(metadata);
    const generatedProperties = upsertGeneratedProperties(metadata);
    const columns = insertProperties
        .map(property => dialect.quoteIdentifier(property.columnName))
        .join(', ');
    const values = insertProperties
        .map(property => parameters.add(toBoundPropertyValue(
            valuesByProperty[property.propertyName],
            property,
            metadata.entityName,
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
    const returningClause = generatedProperties.length > 0
        ? dialect.returningClause?.(generatedProperties.map(
            property => property.columnName,
        ))
        : undefined;
    if (generatedProperties.length > 0 && !returningClause) {
        throw new Error(
            `Postgres upsert cannot safely write store-generated properties on '${metadata.entityName}' without a returning clause.`,
        );
    }
    const returning = returningClause ? ` ${returningClause}` : '';

    return {
        text: `insert into ${dialect.quoteQualifiedIdentifier(metadata.schemaName, metadata.tableName)} (${columns}) values (${values}) on conflict (${conflictColumns}) do update set ${assignments}${returning}`,
        values: parameters.values,
    };
}
