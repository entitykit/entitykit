import type { EntityMetadata } from '../model/entity-metadata';
import {
    buildBatchUpsert,
    buildBatchUpsertFromValues,
    type UpsertSqlOptions,
} from './batch-upsert-sql';
import {
    buildPostgresUpsert,
    type PostgresUpsertSqlOptions,
} from './postgres-upsert-sql';
import { postgresDialect, type SqlDialect } from './sql-dialect';
import type { SqlStatement } from './sql-statement';
import type { EntityPropertyKey } from '../types';

export type { UpsertSqlOptions } from './batch-upsert-sql';
export type { PostgresUpsertSqlOptions } from './postgres-upsert-sql';

/**
 * Builds upserts — inserts that resolve a unique-constraint conflict — in two
 * forms: the provider-neutral batch (`buildUpsertBatch`, whose conflict clause
 * the dialect supplies) and the Postgres `on conflict ... do update`
 * (`buildPostgresUpsert`). Separated because only this family reconciles a
 * conflict target against an update set — the validation both forms share, and
 * which no plain insert, update, or delete needs.
 */
export class UpsertSqlBuilder {
    constructor(private readonly dialect: SqlDialect = postgresDialect) {}

    /**
   * A multi-row upsert, in whatever form the provider spells one.
   *
   * The conflict clause comes from the dialect rather than being written here,
   * because providers disagree about it; a provider that cannot express one is
   * reported by name instead of being handed SQL it will reject.
   */
    public buildUpsertBatch<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        entities: readonly TEntity[],
        options: UpsertSqlOptions<TEntity> = {},
        tenantMatchProperty?: EntityPropertyKey<TEntity>,
    ): SqlStatement {
        return buildBatchUpsert(
            this.dialect,
            metadata,
            entities,
            options,
            tenantMatchProperty,
        );
    }

    public buildUpsertValuesBatch<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        rows: ReadonlyArray<Readonly<Record<string, unknown>>>,
        options: UpsertSqlOptions<TEntity> = {},
        tenantMatchProperty?: EntityPropertyKey<TEntity>,
    ): SqlStatement {
        return buildBatchUpsertFromValues(
            this.dialect,
            metadata,
            rows,
            options,
            tenantMatchProperty,
        );
    }

    public buildPostgresUpsert<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        entity: TEntity,
        options: PostgresUpsertSqlOptions<TEntity> = {},
    ): SqlStatement {
        return buildPostgresUpsert(this.dialect, metadata, entity, options);
    }
}
