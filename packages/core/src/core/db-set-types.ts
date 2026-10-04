import type { EntityConstructor, EntityPropertyKey } from '../types';
import type {
    Queryable,
    UnsafeRawSqlQueryable,
} from '../query/entity-query-types';
import type { EntityEntry } from '../tracking/entity-entry-types';
import type { DatabaseOperationOptions } from '../storage/database-connection';

/** Options for provider-neutral bulk upsert. */
export interface UpsertOptions<TEntity extends object> extends DatabaseOperationOptions {
    /** Properties whose conflict triggers an update; defaults to the key. */
    readonly conflictProperties?: ReadonlyArray<EntityPropertyKey<TEntity>>;
    /** Properties overwritten on conflict; defaults to non-conflict columns. */
    readonly updateProperties?: ReadonlyArray<EntityPropertyKey<TEntity>>;
}

/** Entity-specific gateway for tracking, querying, and set-based writes. */
export interface DbSet<
    TEntity extends object,
    TKey extends readonly unknown[] = readonly unknown[],
    TCreateArguments extends unknown[] = never,
> extends Omit<
        Queryable<TEntity>,
        'executeDelete' | 'executeUpdate' | 'toDebugSql' | 'toPlan' | 'toSql'
    > {
    /** The entity type. */ readonly entityType: EntityConstructor<TEntity>;
    /** Return a matching tracked entity or query by key; return null if absent. Accepts cancellation options. */ find(
        ...keyValuesAndOptions: [...TKey] | [...TKey, DatabaseOperationOptions]
    ): Promise<TEntity | null>;
    /** Find a tracked entity or query by key; throw EntityNotFoundError if absent. Accepts cancellation options. */ findOrThrow(
        ...keyValuesAndOptions: [...TKey] | [...TKey, DatabaseOperationOptions]
    ): Promise<TEntity>;
    /** Construct and track one new entity as Added. No SQL is executed. */ create(
        ...arguments_: TCreateArguments
    ): TEntity;
    /**
     * Track an existing entity as Added and return its tracking entry.
     * Executes no SQL; call saveChanges() to persist it.
     */ add(entity: TEntity): EntityEntry<TEntity>;
    /**
     * Track an existing entity as Unchanged and return its tracking entry.
     * Executes no SQL; subsequent scalar edits are detected by saveChanges().
     */ attach(entity: TEntity): EntityEntry<TEntity>;
    /**
     * Stage deletion and return the tracking entry; cancel insertion for an Added entity.
     * Executes no SQL; call saveChanges() to persist a staged deletion.
     */ remove(entity: TEntity): EntityEntry<TEntity>;
    /**
     * Stop tracking this object and return its former entry, or undefined if absent.
     * Executes no SQL and does not revert property values.
     */ detach(entity: TEntity): EntityEntry<TEntity> | undefined;
    /**
     * Build a caller-owned SQL query; terminal operations execute it.
     * Bypasses ORM query filters and materializes untracked entities by default.
     */ fromSqlUnsafe(
        strings: TemplateStringsArray,
        ...values: readonly unknown[]
    ): UnsafeRawSqlQueryable<TEntity>;
    /**
     * Execute an immediate bulk upsert and return the affected row count.
     * Inputs must be untracked. Bypasses save interceptors, auditing, concurrency
     * tokens, and outbox events. Enforces tenant scope and transactional batching.
     */ executeUpsert(
        entities: readonly TEntity[],
        options?: UpsertOptions<TEntity>,
    ): Promise<number>;
    /** @deprecated Use executeUpsert(); this operation executes SQL immediately. */ upsert(
        entities: readonly TEntity[],
        options?: UpsertOptions<TEntity>,
    ): Promise<number>;
}
