import type { EntityMetadata } from '../model/entity-metadata';
import type { SqlStatement } from './sql-statement';
import { postgresDialect, type SqlDialect } from './sql-dialect';
import { UpsertSqlBuilder } from './upsert-sql-builder';
import type { PostgresUpdateSqlOptions, BulkUpdateSqlOptions } from './update-sql-builder';
import type { PostgresDeleteSqlOptions, BulkDeleteSqlOptions } from './delete-sql-builder';
import type { PostgresUpsertSqlOptions, UpsertSqlOptions } from './upsert-sql-builder';
import { ModificationSqlRelationshipBuilder } from './modification-sql-relationship-builder';
import type { EntityPropertyKey } from '../types';

// Keep the facade's historical operation types importable from this module.
export type { PostgresUpdateSqlOptions, BulkUpdateSqlOptions } from './update-sql-builder';
export type { PostgresDeleteSqlOptions, BulkDeleteSqlOptions } from './delete-sql-builder';
export type { PostgresUpsertSqlOptions, UpsertSqlOptions } from './upsert-sql-builder';
export type { ManyToManyEndpointKey } from './modification-sql-helpers';

/** Compatibility facade delegating DML to its per-verb builders. */
export class ModificationSqlBuilder extends ModificationSqlRelationshipBuilder {
    private readonly upsertBuilder: UpsertSqlBuilder;

    constructor(dialect: SqlDialect = postgresDialect) {
        super(dialect);
        this.upsertBuilder = new UpsertSqlBuilder(dialect);
    }

    public buildInsert<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        entity: TEntity,
        allowMissingProperties: readonly string[] = [],
    ): SqlStatement {
        return this.insertBuilder.buildInsert(metadata, entity, allowMissingProperties);
    }

    public buildInsertBatch<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        entities: readonly TEntity[],
    ): SqlStatement {
        return this.insertBuilder.buildInsertBatch(metadata, entities);
    }

    public buildUpsertBatch<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        entities: readonly TEntity[],
        options: UpsertSqlOptions<TEntity> = {},
        tenantMatchProperty?: EntityPropertyKey<TEntity>,
    ): SqlStatement {
        return this.upsertBuilder.buildUpsertBatch(
            metadata,
            entities,
            options,
            tenantMatchProperty,
        );
    }

    public buildPostgresUpsert<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        entity: TEntity,
        options: PostgresUpsertSqlOptions<TEntity> = {},
    ): SqlStatement {
        return this.upsertBuilder.buildPostgresUpsert(metadata, entity, options);
    }

    public buildPostgresUpdate<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        options: PostgresUpdateSqlOptions<TEntity>,
    ): SqlStatement {
        return this.updateBuilder.buildPostgresUpdate(metadata, options);
    }

    public buildPostgresDelete<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        options: PostgresDeleteSqlOptions,
    ): SqlStatement {
        return this.deleteBuilder.buildPostgresDelete(metadata, options);
    }

    public buildBulkUpdate<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        options: BulkUpdateSqlOptions<TEntity>,
    ): SqlStatement {
        return this.updateBuilder.buildBulkUpdate(metadata, options);
    }

    public buildBulkDelete<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        options: BulkDeleteSqlOptions,
    ): SqlStatement {
        return this.deleteBuilder.buildBulkDelete(metadata, options);
    }

    public buildUpdate<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        entity: TEntity,
        modifiedProperties: readonly string[],
        originalValues: Readonly<Record<string, unknown>> = {},
    ): SqlStatement | undefined {
        return this.updateBuilder.buildUpdate(metadata, entity, modifiedProperties, originalValues);
    }

    public buildDelete<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        entity: TEntity,
        originalValues: Readonly<Record<string, unknown>> = {},
    ): SqlStatement {
        return this.deleteBuilder.buildDelete(metadata, entity, originalValues);
    }

}
