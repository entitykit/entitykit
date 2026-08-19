import type { EntityMetadata } from '../model/entity-metadata';
import type { EntityPropertyKey } from '../types';
import type { UpsertSqlOptions } from './batch-upsert-sql';
import { buildBatchUpsertStatement } from './batch-upsert-statement';
import type { SqlDialect } from './sql-dialect';
import type { SqlStatement } from './sql-statement';
import { buildUpsertProviderValueRows } from './upsert-value-sql';

/** Build an upsert from already converted, cloned provider-value rows. */
export function buildBatchUpsertFromProviderValues<TEntity extends object>(
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
        (parameters, properties) => buildUpsertProviderValueRows(
            rows,
            properties,
            parameters,
        ),
        options,
        tenantMatchProperty,
    );
}
