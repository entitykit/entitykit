import type { EntityMetadata } from '../model/entity-metadata';
import type { ManyToManyMetadata } from '../model/many-to-many-metadata';
import type { SqlStatement } from './sql-statement';
import { postgresDialect, type SqlDialect } from './sql-dialect';
import { UpdateSqlBuilder } from './update-sql-builder';
import { DeleteSqlBuilder } from './delete-sql-builder';
import { UpsertSqlBuilder } from './upsert-sql-builder';
import type { PostgresUpdateSqlOptions, BulkUpdateSqlOptions } from './update-sql-builder';
import type { PostgresDeleteSqlOptions, BulkDeleteSqlOptions } from './delete-sql-builder';
import type { PostgresUpsertSqlOptions, UpsertSqlOptions } from './upsert-sql-builder';
import type { ManyToManyEndpointKey } from './modification-sql-helpers';
import { ModificationSqlOutboxBuilder } from './modification-sql-outbox-builder';

// Keep the facade's historical operation types importable from this module.
export type { PostgresUpdateSqlOptions, BulkUpdateSqlOptions } from './update-sql-builder';
export type { PostgresDeleteSqlOptions, BulkDeleteSqlOptions } from './delete-sql-builder';
export type { PostgresUpsertSqlOptions, UpsertSqlOptions } from './upsert-sql-builder';
export type { ManyToManyEndpointKey } from './modification-sql-helpers';

/** Compatibility facade delegating DML to its per-verb builders. */
export class ModificationSqlBuilder extends ModificationSqlOutboxBuilder {
    private readonly updateBuilder: UpdateSqlBuilder;
    private readonly deleteBuilder: DeleteSqlBuilder;
    private readonly upsertBuilder: UpsertSqlBuilder;

    constructor(dialect: SqlDialect = postgresDialect) {
        super(dialect);
        this.updateBuilder = new UpdateSqlBuilder(dialect);
        this.deleteBuilder = new DeleteSqlBuilder(dialect);
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

    public buildInsertFromValues<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        values: Readonly<Record<string, unknown>>,
        allowMissingProperties: readonly string[] = [],
    ): SqlStatement {
        return this.insertBuilder.buildInsertFromValues(
            metadata,
            values,
            allowMissingProperties,
        );
    }

    public buildInsertBatchFromValues<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        rows: ReadonlyArray<Readonly<Record<string, unknown>>>,
    ): SqlStatement {
        return this.insertBuilder.buildInsertBatchFromValues(metadata, rows);
    }

    public buildUpsertBatch<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        entities: readonly TEntity[],
        options: UpsertSqlOptions<TEntity> = {},
    ): SqlStatement {
        return this.upsertBuilder.buildUpsertBatch(metadata, entities, options);
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

    public buildUpdateFromValues<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        values: Readonly<Record<string, unknown>>,
        modifiedProperties: readonly string[],
        originalValues: Readonly<Record<string, unknown>> = {},
    ): SqlStatement | undefined {
        return this.updateBuilder.buildUpdateFromValues(
            metadata,
            values,
            modifiedProperties,
            originalValues,
        );
    }

    public buildInsertManyToMany<TEntity extends object>(
        relationship: ManyToManyMetadata<TEntity>,
        sourceKeyValues: ManyToManyEndpointKey,
        targetKeyValues: ManyToManyEndpointKey,
    ): SqlStatement {
        return this.insertBuilder.buildInsertManyToMany(relationship, sourceKeyValues, targetKeyValues);
    }

    public buildInsertManyToManyBatch<TEntity extends object>(
        relationship: ManyToManyMetadata<TEntity>,
        pairs: ReadonlyArray<readonly [unknown, unknown]>,
    ): SqlStatement {
        return this.insertBuilder.buildInsertManyToManyBatch(relationship, pairs);
    }

    public buildDeleteManyToMany<TEntity extends object>(
        relationship: ManyToManyMetadata<TEntity>,
        sourceKeyValues: ManyToManyEndpointKey,
        targetKeyValues: ManyToManyEndpointKey,
    ): SqlStatement {
        return this.deleteBuilder.buildDeleteManyToMany(relationship, sourceKeyValues, targetKeyValues);
    }

    public buildDeleteManyToManyBatch<TEntity extends object>(
        relationship: ManyToManyMetadata<TEntity>,
        pairs: ReadonlyArray<readonly [unknown, unknown]>,
    ): SqlStatement {
        return this.deleteBuilder.buildDeleteManyToManyBatch(relationship, pairs);
    }

    public buildDelete<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        entity: TEntity,
        originalValues: Readonly<Record<string, unknown>> = {},
    ): SqlStatement {
        return this.deleteBuilder.buildDelete(metadata, entity, originalValues);
    }

    public buildDeleteFromValues<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        values: Readonly<Record<string, unknown>>,
        originalValues: Readonly<Record<string, unknown>> = {},
    ): SqlStatement {
        return this.deleteBuilder.buildDeleteFromValues(
            metadata,
            values,
            originalValues,
        );
    }
}
