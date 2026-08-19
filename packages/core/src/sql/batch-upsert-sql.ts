import type { EntityMetadata } from '../model/entity-metadata';
import type { EntityPropertyKey } from '../types';
import type { SqlDialect } from './sql-dialect';
import type { SqlStatement } from './sql-statement';
import { readEntityValues } from '../tracking/entity-entry-snapshot';
import { buildUpsertValueRows } from './upsert-value-sql';
import { buildBatchUpsertStatement } from './batch-upsert-statement';

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
    return buildBatchUpsertStatement(
        dialect,
        metadata,
        rows.length,
        (parameters, properties) => buildUpsertValueRows(
            metadata,
            rows,
            properties,
            parameters,
        ),
        options,
        tenantMatchProperty,
    );
}
