import type { EntityMetadata } from '../model/entity-metadata';
import { toBoundPropertyValue } from '../model/value-converter/store-value';
import type { EntityPropertyKey } from '../types';
import { validateRequiredProperties } from './modification-sql-helpers';
import type { SqlDialect } from './sql-dialect';
import { SqlParameterBag, type SqlStatement } from './sql-statement';
import { validateUpsertConflictTarget } from './upsert-conflict-target';
import { resolveUpsertProperties } from './upsert-property-selection';
import { readPropertyValue } from '../model/property-value-access';

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
    if (entities.length === 0) {
        throw new Error('At least one entity is required.');
    }

    const { conflictProperties, updateProperties } = resolveUpsertProperties(
        metadata,
        options,
    );
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

    const parameters = new SqlParameterBag(dialect);
    const columns = metadata.properties
        .map(property => dialect.quoteIdentifier(property.columnName))
        .join(', ');
    const rows = entities.map(entity => {
        validateRequiredProperties(metadata, entity);
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
        text: `insert into ${dialect.quoteQualifiedIdentifier(metadata.schemaName, metadata.tableName)} (${columns}) values ${rows.join(', ')} ${clause}`,
        values: parameters.values,
    };
}
