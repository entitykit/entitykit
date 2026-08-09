import type { EntityMetadata } from '../model/entity-metadata';
import type { EntityPropertyKey } from '../types';
import type { SqlDialect } from './sql-dialect';
import { SqlParameterBag, type SqlStatement } from './sql-statement';
import { validateUpsertConflictTarget } from './upsert-conflict-target';
import {
    assertResolvableUpsertConflict,
    resolveUpsertProperties,
} from './upsert-property-selection';
import { readEntityValues } from '../tracking/entity-entry-snapshot';
import {
    buildUpsertValueRows,
    resolveUpsertWriteShape,
} from './upsert-value-sql';

export interface UpsertSqlOptions<TEntity extends object> {
    /** Columns whose conflict triggers the update. Defaults to the primary key. */
    readonly conflictProperties?: ReadonlyArray<EntityPropertyKey<TEntity>>;
    /** Columns to overwrite on conflict. Defaults to everything but the conflict target. */
    readonly updateProperties?: ReadonlyArray<EntityPropertyKey<TEntity>>;
}

export function buildBatchUpsert<TEntity extends object>(
    dialect: SqlDialect,
    metadata: EntityMetadata<TEntity>,
    entities: readonly TEntity[],
    options: UpsertSqlOptions<TEntity> = {},
    tenantMatchProperty?: EntityPropertyKey<TEntity>,
): SqlStatement {
    return buildBatchUpsertFromValues(
        dialect,
        metadata,
        entities.map(entity => readEntityValues(metadata, entity)),
        options,
        tenantMatchProperty,
    );
}

export function buildBatchUpsertFromValues<TEntity extends object>(
    dialect: SqlDialect,
    metadata: EntityMetadata<TEntity>,
    rows: ReadonlyArray<Readonly<Record<string, unknown>>>,
    options: UpsertSqlOptions<TEntity> = {},
    tenantMatchProperty?: EntityPropertyKey<TEntity>,
): SqlStatement {
    if (rows.length === 0) {
        throw new Error('At least one entity is required.');
    }

    const { conflictProperties, updateProperties } = resolveUpsertProperties(
        metadata,
        options,
    );
    assertResolvableUpsertConflict(metadata, conflictProperties);
    validateUpsertConflictTarget(
        dialect,
        metadata,
        conflictProperties,
        tenantMatchProperty,
    );
    const clause = dialect.upsertClause?.(
        conflictProperties.map(property => property.columnName),
        updateProperties.map(property => property.columnName),
        dialect.upsertConflictTarget === 'anyUnique' || !tenantMatchProperty
            ? []
            : [metadata.getProperty(tenantMatchProperty).columnName],
        { schemaName: metadata.schemaName, tableName: metadata.tableName },
    );
    if (!clause) {
        throw new Error(
            `The '${dialect.name}' dialect does not support upsert. ` +
      'Use add(...) with saveChanges(), or provider-specific SQL.',
        );
    }

    const write = resolveUpsertWriteShape(dialect, metadata, rows.length);
    const parameters = new SqlParameterBag(dialect);
    const columns = write.insertProperties
        .map(property => dialect.quoteIdentifier(property.columnName))
        .join(', ');
    const valueSql = buildUpsertValueRows(
        metadata, rows, write.insertProperties, parameters,
    );

    return {
        text: `insert into ${dialect.quoteQualifiedIdentifier(metadata.schemaName, metadata.tableName)} (${columns}) values ${valueSql} ${clause}${write.returning}`,
        values: parameters.values,
    };
}
