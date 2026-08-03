import type { EntityConstructor } from '../types';
import type { DbSetContext } from './db-set-context';
import type { EntityMetadata } from '../model/entity-metadata';
import type { UpsertSqlOptions } from '../sql/modification-sql-builder';
import { Queryable } from '../query/queryable';
import { RawSqlQueryable } from '../query/raw-sql-queryable';
import { EntityState } from '../tracking/entity-state';
import { buildRawSql } from '../sql/raw-sql';
import type { EntityEntry } from '../tracking/entity-entry';
import { DbSetQueryBuilder } from './db-set-query-builder';
import { DbSetDiagnostics } from './db-set-diagnostics';
import { DbSetBulkWriter } from './db-set-bulk-writer';
import { DbSetQueryExecutor } from './db-set-query-executor';
import type { DatabaseOperationOptions } from '../storage/database-connection';

/** Entity-specific gateway for tracking, querying, and set-based writes. */
export class DbSet<TEntity extends object> extends DbSetQueryBuilder<TEntity> {
    private readonly queryExecutor: DbSetQueryExecutor<TEntity>;
    private readonly writer: DbSetBulkWriter<TEntity>;

    constructor(
        private readonly context: DbSetContext,
        public readonly entityType: EntityConstructor<TEntity>,
        private readonly cancelAddedEntity: (entity: object) => void =
            entity => context.changeTracker.detach(entity),
    ) {
        super();
        const diagnostics = new DbSetDiagnostics(context, entityType);
        this.queryExecutor = new DbSetQueryExecutor(context, entityType, diagnostics);
        this.writer = new DbSetBulkWriter(context, entityType, diagnostics);
    }

    public get metadata(): EntityMetadata<TEntity> {
        return this.context.modelMetadata.getEntity(this.entityType);
    }

    // Read-side fluent methods route through the private executor adapter, so
    // query infrastructure does not become part of DbSet's public API.
    protected query(): Queryable<TEntity> {
        return new Queryable(this.metadata, this.queryExecutor);
    }

    protected findTracked(keyValues: readonly unknown[]): TEntity | undefined {
        return this.context.changeTracker.tryGetByIdentityValues(
            this.metadata,
            keyValues,
        )?.entity;
    }

    /** Start tracking a new entity as `Added`. */
    public add(entity: TEntity): EntityEntry<TEntity> {
        this.metadata.assertWritable('add()');
        return this.context.changeTracker.track(entity, this.metadata, EntityState.Added).useNavigationLoader(this.context);
    }

    /** Start tracking an existing entity as `Unchanged`. */
    public attach(entity: TEntity): EntityEntry<TEntity> {
        this.metadata.assertWritable('attach()');
        return this.context.changeTracker.track(entity, this.metadata, EntityState.Unchanged).useNavigationLoader(this.context);
    }

    /** Mark an entity as deleted, or cancel it when it was just added. */
    public remove(entity: TEntity): EntityEntry<TEntity> {
        this.metadata.assertWritable('remove()');
        const entry = this.context.changeTracker.entry(entity) ?? this.attach(entity);
        if (entry.state === EntityState.Added) {
            this.cancelAddedEntity(entity);
            return entry.useNavigationLoader(this.context);
        }
        entry.markDeleted();
        return entry.useNavigationLoader(this.context);
    }

    /** Stop tracking an entity instance. */
    public detach(entity: TEntity): EntityEntry<TEntity> | undefined {
        return this.context.changeTracker.detach(entity);
    }

    /**
   * Start a raw SQL query that materializes rows as this entity type.
   */
    public fromSql(strings: TemplateStringsArray, ...values: readonly unknown[]): RawSqlQueryable<TEntity> {
        return new RawSqlQueryable(
            this.metadata,
            this.context.database,
            this.context.changeTracker,
            buildRawSql(this.context.dialect, strings, ...values),
            this.context.valueReader,
        );
    }

    /**
   * Insert entities, overwriting rows that already exist. See
   * `DbSetBulkWriter.upsert` for the batching and tenant-scope rules.
   */
    public async upsert(
        entities: readonly TEntity[],
        options: UpsertSqlOptions<TEntity> & DatabaseOperationOptions = {},
    ): Promise<number> {
        this.metadata.assertWritable('upsert()');
        return this.writer.upsert(entities, options);
    }
}
