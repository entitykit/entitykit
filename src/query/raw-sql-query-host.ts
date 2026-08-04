import type { EntityMetadata } from '../model/entity-metadata';
import type { SqlStatement } from '../sql/sql-statement';
import type { DatabaseConnection } from '../storage/database-connection';
import type { StoreValueReader } from '../storage/store-value-reader';
import type { ChangeTracker } from '../tracking/change-tracker';

export interface RawSqlQueryFilters {
    readonly ignoreQueryFilters: boolean;
    readonly ignoreTenantScope: boolean;
}

export interface RawSqlQueryHost {
    readonly database: DatabaseConnection;
    readonly changeTracker: ChangeTracker;
    readonly valueReader: StoreValueReader | undefined;

    assertCanQuery(operation: string): void;

    buildStatement<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        statement: SqlStatement,
        filters: RawSqlQueryFilters,
    ): SqlStatement;
}
