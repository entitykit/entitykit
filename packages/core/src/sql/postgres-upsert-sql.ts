import type { EntityMetadata } from '../model/entity-metadata';
import type { EntityPropertyKey } from '../types';
import type { SqlDialect } from './sql-dialect';
import { SqlParameterBag, type SqlStatement } from './sql-statement';
import {
    assertResolvableUpsertConflict,
    resolveUpsertProperties,
} from './upsert-property-selection';
import { readEntityValues } from '../tracking/entity-entry-snapshot';
import { validateRequiredComplexProperties } from './required-complex-property-validation';
import {
    buildUpsertValueRows,
    resolveUpsertWriteShape,
} from './upsert-value-sql';

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

    const { conflictProperties, updateProperties } = resolveUpsertProperties(
        metadata,
        options,
        'Postgres upsert',
    );
    assertResolvableUpsertConflict(metadata, conflictProperties);

    const parameters = new SqlParameterBag(dialect);
    const write = resolveUpsertWriteShape(dialect, metadata, 1);
    const columns = write.insertProperties
        .map(property => dialect.quoteIdentifier(property.columnName))
        .join(', ');
    const values = buildUpsertValueRows(
        metadata, [valuesByProperty], write.insertProperties, parameters,
    );
    const conflictColumns = conflictProperties
        .map(property => dialect.quoteIdentifier(property.columnName))
        .join(', ');
    const assignments = updateProperties
        .map(property =>
            `${dialect.quoteIdentifier(property.columnName)} = excluded.${dialect.quoteIdentifier(property.columnName)}`,
        )
        .join(', ');
    return {
        text: `insert into ${dialect.quoteQualifiedIdentifier(metadata.schemaName, metadata.tableName)} (${columns}) values ${values} on conflict (${conflictColumns}) do update set ${assignments}${write.returning}`,
        values: parameters.values,
    };
}
