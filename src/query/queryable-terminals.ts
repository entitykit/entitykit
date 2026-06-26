import { SelectSqlBuilder } from '../sql/select-sql-builder';
import type { SqlStatement } from '../sql/sql-statement';
import { QueryableBase } from './queryable-base';
import { terminalQueryLimit } from './terminal-query-limit';
import type { EntityUpdateValues } from '../types';
import { formatDebugSql, type DebugSqlOptions } from '../sql/debug-sql';
import { ProviderCapabilityError } from '../errors/runtime-errors';
import type { DatabaseOperationOptions, QueryStreamOptions } from '../storage/database-connection';
import {
    firstResultOrNull,
    requireQueryResult,
    singleResultOrNull,
} from './query-cardinality';
/**
 * The terminal operations of a `Queryable`: the reads that materialize entities,
 * the set-based `executeUpdate`/`executeDelete` writes, and the `toSql` rendering.
 *
 * Split out of `QueryableBase` purely to keep both files within the module size
 * budget; it is the same class, one inheritance step down. It stays abstract and
 * carries no `Queryable` value dependency. Refinements such as `take` are
 * inherited from the base, and the concrete `Queryable`
 * supplies the `with()` factory. Every method is a leaf of the fluent chain: it
 * runs the query rather than returning another builder.
 */
export abstract class QueryableTerminals<TEntity extends object> extends QueryableBase<TEntity> {
    /**
   * Execute the query and return all matching entities.
   */
    public async toArray(options?: DatabaseOperationOptions): Promise<TEntity[]> {
        return this.executor.executeToArray(this.toQueryModel(), options);
    }

    /** Stream matching entities without buffering the complete result set. */
    public stream(options?: QueryStreamOptions): AsyncIterable<TEntity> {
        if (!this.executor.executeStream) {
            throw new ProviderCapabilityError('streaming queries');
        }
        return this.executor.executeStream(this.toQueryModel(), options);
    }

    /**
   * Execute the query and return the first entity, or null.
   */
    public async firstOrNull(options?: DatabaseOperationOptions): Promise<TEntity | null> {
        const rows = await this.take(
            terminalQueryLimit(this.model.limit, 1),
        ).toArray(options);
        return firstResultOrNull(rows);
    }

    /**
   * Execute the query and return the first entity, or throw `EntityNotFoundError`.
   */
    public async first(options?: DatabaseOperationOptions): Promise<TEntity> {
        return requireQueryResult(
            await this.firstOrNull(options),
            this.metadata.entityName,
        );
    }

    /**
   * Execute the query and return one entity, null, or throw if multiple rows match.
   */
    public async singleOrNull(options?: DatabaseOperationOptions): Promise<TEntity | null> {
        const rows = await this.take(
            terminalQueryLimit(this.model.limit, 2),
        ).toArray(options);
        return singleResultOrNull(rows, this.metadata.entityName);
    }

    /**
   * Execute the query and return exactly one entity.
   */
    public async single(options?: DatabaseOperationOptions): Promise<TEntity> {
        return requireQueryResult(
            await this.singleOrNull(options),
            this.metadata.entityName,
        );
    }

    /**
   * Execute a `count(*)` query.
   */
    public async count(options?: DatabaseOperationOptions): Promise<number> {
        return this.executor.executeCount(this.toQueryModel(), options);
    }

    /**
   * Execute an `exists` query.
   */
    public async exists(options?: DatabaseOperationOptions): Promise<boolean> {
        return this.executor.executeExists(this.toQueryModel(), options);
    }

    /**
   * Update every matching row with one `update ... where ...` statement and
   * return the number of rows affected.
   *
   * This runs in the database, not through the change tracker: entities are
   * never loaded, `saveChanges()` is not involved, and no interceptors, audit
   * fields, concurrency tokens, or outbox events apply. Entities already
   * tracked by this context keep their old values, so reload them if you need
   * the new ones.
   *
   * A `where(...)` filter is required, so an unfiltered call cannot rewrite the
   * whole table by accident. Tenant and soft-delete filters still apply.
   */
    public async executeUpdate(
        values: EntityUpdateValues<TEntity>,
        options?: DatabaseOperationOptions,
    ): Promise<number> {
        if (!this.executor.executeUpdate) {
            throw new ProviderCapabilityError('executeUpdate()');
        }

        return this.executor.executeUpdate(this.toQueryModel(), values, options);
    }

    /**
   * Delete every matching row with one `delete ... where ...` statement and
   * return the number of rows affected.
   *
   * Like `executeUpdate()`, this runs in the database rather than through the
   * change tracker, so cascade behavior is whatever the database's foreign-key
   * constraints enforce. A `where(...)` filter is required.
   */
    public async executeDelete(options?: DatabaseOperationOptions): Promise<number> {
        if (!this.executor.executeDelete) {
            throw new ProviderCapabilityError('executeDelete()');
        }
        return this.executor.executeDelete(this.toQueryModel(), options);
    }

    /**
   * Build the SQL statement for this query without executing it.
   */
    public toSql(): SqlStatement {
        const model = this.toQueryModel();
        return this.executor.buildSelectSql?.(model) ?? new SelectSqlBuilder().build(this.metadata, model);
    }

    /**
   * Build a debug string containing SQL text and parameter values.
   */
    public toDebugSql(options: DebugSqlOptions = {}): string {
        return formatDebugSql(this.toSql(), options);
    }
}
