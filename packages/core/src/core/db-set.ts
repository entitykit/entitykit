import type { EntityConstructor } from '../types';
import type { DbSetContext } from './db-set-context';
import type { EntityMetadata } from '../model/entity-metadata';
import type { UpsertSqlOptions } from '../sql/modification-sql-builder';
import { Queryable } from '../query/queryable';
import { UnsafeRawSqlQueryable } from '../query/unsafe-raw-sql-queryable';
import { EntityState } from '../tracking/entity-state';
import { buildRawSql } from '../sql/raw-sql';
import type { EntityEntry } from '../tracking/entity-entry-types';
import { publicEntityEntry } from '../tracking/public-entity-entry';
import { DbSetQueryBuilder } from './db-set-query-builder';
import { DbSetDiagnostics } from './db-set-diagnostics';
import { DbSetBulkWriter } from './db-set-bulk-writer';
import { DbSetQueryExecutor } from './db-set-query-executor';
import type { DatabaseOperationOptions } from '../storage/database-connection';
import { resolveTrackedFind } from './tracked-find-resolver';
import { createDbSetRawQueryHost } from './db-set-raw-query-host';
import type { QueryFilterOperation } from './query-filter-operation';
import type { QueryModel } from '../query/query-model';
import { addDbSetEntity } from './db-set-add';
import { createDbSetEntity } from './db-set-create';
import { removeDbSetEntity } from './db-set-remove';
import type { EntityCreationFunction } from './db-set-creation-types';
import type { BoundFindValues } from './bound-find-values';

/** Entity-specific gateway for tracking, querying, and set-based writes. */
export class DbSet<TEntity extends object> extends DbSetQueryBuilder<TEntity> {
    private readonly queryExecutor: DbSetQueryExecutor<TEntity>;
    private readonly writer: DbSetBulkWriter<TEntity>;

    constructor(
        private readonly context: DbSetContext,
        public readonly entityType: EntityConstructor<TEntity>,
        private readonly cancelAddedEntity: (entity: object) => void =
            entity => context.changeTracker.detach(entity),
        private readonly creationFactory?: EntityCreationFunction<TEntity>,
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

    protected findTracked(
        values: BoundFindValues,
        operation: QueryFilterOperation,
        options?: DatabaseOperationOptions,
    ): TEntity | null | undefined {
        return resolveTrackedFind(
            this.context,
            this.metadata,
            values,
            operation,
            options,
        );
    }

    protected beginQueryOperation(): QueryFilterOperation {
        return this.context.beginQueryOperation();
    }

    protected async executeFindQuery(
        model: QueryModel<TEntity>,
        operation: QueryFilterOperation,
        options?: DatabaseOperationOptions,
    ): Promise<TEntity[]> {
        return this.queryExecutor.executeToArrayInOperation(model, operation, options);
    }

    /** Construct and track a new entity as `Added`, without executing SQL. */
    public create(...arguments_: unknown[]): TEntity {
        return createDbSetEntity(
            this.context, this.metadata, this.entityType, this.creationFactory, arguments_,
        );
    }

    /** Start tracking a new entity as `Added`. */
    public add(entity: TEntity): EntityEntry<TEntity> {
        return addDbSetEntity(this.context, this.metadata, entity);
    }

    /** Start tracking an existing entity as `Unchanged`. */
    public attach(entity: TEntity): EntityEntry<TEntity> {
        this.context.assertStateUsable?.('attach()');
        this.metadata.assertWritable('attach()');
        return publicEntityEntry(
            this.context.changeTracker.track(
                entity,
                this.metadata,
                EntityState.Unchanged,
            ),
            this.context,
        );
    }

    /** Mark an entity as deleted, or cancel it when it was just added. */
    public remove(entity: TEntity): EntityEntry<TEntity> {
        return removeDbSetEntity(this.context, this.metadata, entity, this.cancelAddedEntity);
    }

    /** Stop tracking an entity instance. */
    public detach(entity: TEntity): EntityEntry<TEntity> | undefined {
        this.context.assertStateUsable?.('detach()');
        const entry = this.context.changeTracker.detach(entity);
        return entry ? publicEntityEntry(entry, this.context) : undefined;
    }

    /**
   * Execute caller-owned SQL as this entity type without ORM query filters.
   */
    public fromSqlUnsafe(
        strings: TemplateStringsArray,
        ...values: readonly unknown[]
    ): UnsafeRawSqlQueryable<TEntity> {
        return new UnsafeRawSqlQueryable(
            this.metadata,
            createDbSetRawQueryHost(this.context),
            buildRawSql(this.context.dialect, strings, ...values),
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
        this.context.assertStateUsable?.('upsert()');
        this.metadata.assertWritable('upsert()');
        return this.writer.upsert(entities, options);
    }
}
