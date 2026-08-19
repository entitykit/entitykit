import type { EntityMetadata } from '../model/entity-metadata';
import type { EntityPropertyKey } from '../types';
import type { UpsertSqlOptions } from './batch-upsert-sql';
import type { SqlDialect } from './sql-dialect';
import { SqlParameterBag, type SqlStatement } from './sql-statement';
import { validateUpsertConflictTarget } from './upsert-conflict-target';
import {
    assertResolvableUpsertConflict,
    resolveUpsertProperties,
} from './upsert-property-selection';
import { resolveUpsertWriteShape } from './upsert-value-sql';

type UpsertRowBinder<TEntity extends object> = (
    parameters: SqlParameterBag,
    properties: ReturnType<typeof resolveUpsertWriteShape<TEntity>>['insertProperties'],
) => string;

/** Assemble one provider-neutral upsert around a caller-owned row binder. */
export function buildBatchUpsertStatement<TEntity extends object>(
    dialect: SqlDialect,
    metadata: EntityMetadata<TEntity>,
    rowCount: number,
    bindRows: UpsertRowBinder<TEntity>,
    options: UpsertSqlOptions<TEntity>,
    tenantMatchProperty?: EntityPropertyKey<TEntity>,
): SqlStatement {
    if (rowCount === 0) {
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

    const write = resolveUpsertWriteShape(dialect, metadata, rowCount);
    const parameters = new SqlParameterBag(dialect);
    const columns = write.insertProperties
        .map(property => dialect.quoteIdentifier(property.columnName))
        .join(', ');
    const valueSql = bindRows(parameters, write.insertProperties);

    return {
        text: `insert into ${dialect.quoteQualifiedIdentifier(metadata.schemaName, metadata.tableName)} (${columns}) values ${valueSql} ${clause}${write.returning}`,
        values: parameters.values,
    };
}
