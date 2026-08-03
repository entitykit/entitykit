import type { EntityConstructor, EntityPropertyKey } from '../types';
import type { Queryable, RawSqlQueryable } from '../query/entity-query-types';
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
> extends Omit<
        Queryable<TEntity>,
        'executeDelete' | 'executeUpdate' | 'toDebugSql' | 'toPlan' | 'toSql'
    > {
    /** The entity type. */ readonly entityType: EntityConstructor<TEntity>;
    /** Find by key, optionally followed by cancelable operation options. */ find(
        ...keyValuesAndOptions: [...TKey] | [...TKey, DatabaseOperationOptions]
    ): Promise<TEntity | null>;
    /** Find by key or throw, optionally followed by cancelable operation options. */ findOrThrow(
        ...keyValuesAndOptions: [...TKey] | [...TKey, DatabaseOperationOptions]
    ): Promise<TEntity>;
    /** Perform the add operation. */ add(entity: TEntity): EntityEntry<TEntity>;
    /** Perform the attach operation. */ attach(entity: TEntity): EntityEntry<TEntity>;
    /** Perform the remove operation. */ remove(entity: TEntity): EntityEntry<TEntity>;
    /** Perform the detach operation. */ detach(entity: TEntity): EntityEntry<TEntity> | undefined;
    /** Perform the from sql operation. */ fromSql(
        strings: TemplateStringsArray,
        ...values: readonly unknown[]
    ): RawSqlQueryable<TEntity>;
    /** Perform the upsert operation. */ upsert(
        entities: readonly TEntity[],
        options?: UpsertOptions<TEntity>,
    ): Promise<number>;
}
