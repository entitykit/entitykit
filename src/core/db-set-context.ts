import type { DbContextOptions } from './context-options/db-context-option-types';
import type { Model } from '../model/model';
import type { EntityMetadata } from '../model/entity-metadata';
import type { QueryModel } from '../query/query-model';
import type { SqlDialect } from '../sql/sql-dialect';
import type { DatabaseConnection } from '../storage/database-connection';
import type { StoreValueReader } from '../storage/store-value-reader';
import type { ChangeTracker } from '../tracking/change-tracker';
import type { EntityNavigationLoader } from '../tracking/navigation-entry';
import type { QueryFilterOperation } from './query-filter-operation';

/** The context capabilities used by `DbSet` and its focused collaborators. */
export interface DbSetContext extends EntityNavigationLoader {
    readonly options: DbContextOptions;
    readonly database: DatabaseConnection;
    readonly dialect: SqlDialect;
    readonly valueReader: StoreValueReader | undefined;
    readonly modelMetadata: Model;
    readonly changeTracker: ChangeTracker;

    assertCanQuery(operation: string): void;

    applyQueryFilters<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        query: QueryModel<TEntity>
    ): QueryModel<TEntity>;

    beginQueryOperation(): QueryFilterOperation;

    currentTenantIdForWrites(): unknown;
    allowsCrossTenantAccess(): boolean;
}
