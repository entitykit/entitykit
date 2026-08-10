import type { Model } from '../model/model';
import type { EntityMetadata } from '../model/entity-metadata';
import type { QueryModel } from '../query/query-model';
import type { DatabaseConnection } from '../storage/database-connection';
import type { EntityEntry } from '../tracking/entity-entry';
import type { ChangeTracker } from '../tracking/change-tracker';
import type { DbContextOptions } from './context-options/db-context-option-types';
import type { DbSetContext } from './db-set-context';
import type { QueryFilterOperation } from './query-filter-operation';

interface DbSetContextAdapterOptions {
    readonly options: () => DbContextOptions;
    readonly database: () => DatabaseConnection;
    readonly model: () => Model;
    readonly changeTracker: ChangeTracker;
    readonly assertCanQuery: (operation: string) => void;
    readonly applyQueryFilters: <TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        query: QueryModel<TEntity>,
    ) => QueryModel<TEntity>;
    readonly beginQueryOperation: () => QueryFilterOperation;
    readonly currentTenantIdForWrites: () => unknown;
    readonly allowsCrossTenantAccess: () => boolean;
    readonly registerTransactionState: (
        afterCommit: () => void,
        afterRollback: () => void,
    ) => void;
    readonly markStateRestorationFailure: (cause: unknown) => void;
    readonly loadNavigation: <TEntity extends object>(
        entry: EntityEntry<TEntity>,
        navigationProperty: string,
    ) => Promise<unknown>;
}

/** Adapt context-owned runtime services to the narrow contract consumed by DbSet. */
export function createDbSetContextAdapter(options: DbSetContextAdapterOptions): DbSetContext {
    return {
        get options() {
            return options.options();
        },
        get database() {
            return options.database();
        },
        get dialect() {
            return options.options().dialect;
        },
        get valueReader() {
            return options.options().valueReader;
        },
        get modelMetadata() {
            return options.model();
        },
        changeTracker: options.changeTracker,
        assertCanQuery: options.assertCanQuery,
        applyQueryFilters: options.applyQueryFilters,
        beginQueryOperation: options.beginQueryOperation,
        currentTenantIdForWrites: options.currentTenantIdForWrites,
        allowsCrossTenantAccess: options.allowsCrossTenantAccess,
        registerTransactionState: options.registerTransactionState,
        markStateRestorationFailure: options.markStateRestorationFailure,
        loadNavigation: options.loadNavigation,
    };
}
