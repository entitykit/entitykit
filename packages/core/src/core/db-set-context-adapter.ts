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
    readonly assertStateUsable: (operation: string) => void;
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

class RuntimeDbSetContext implements DbSetContext {
    public readonly changeTracker: DbSetContextAdapterOptions['changeTracker'];
    public readonly assertCanQuery: DbSetContextAdapterOptions['assertCanQuery'];
    public readonly assertStateUsable: DbSetContextAdapterOptions['assertStateUsable'];
    public readonly applyQueryFilters: DbSetContextAdapterOptions['applyQueryFilters'];
    public readonly beginQueryOperation: DbSetContextAdapterOptions['beginQueryOperation'];
    public readonly currentTenantIdForWrites: DbSetContextAdapterOptions['currentTenantIdForWrites'];
    public readonly allowsCrossTenantAccess: DbSetContextAdapterOptions['allowsCrossTenantAccess'];
    public readonly registerTransactionState: DbSetContextAdapterOptions['registerTransactionState'];
    public readonly markStateRestorationFailure: DbSetContextAdapterOptions['markStateRestorationFailure'];
    public readonly loadNavigation: DbSetContextAdapterOptions['loadNavigation'];

    constructor(private readonly services: DbSetContextAdapterOptions) {
        this.changeTracker = services.changeTracker;
        this.assertCanQuery = services.assertCanQuery;
        this.assertStateUsable = services.assertStateUsable;
        this.applyQueryFilters = services.applyQueryFilters;
        this.beginQueryOperation = services.beginQueryOperation;
        this.currentTenantIdForWrites = services.currentTenantIdForWrites;
        this.allowsCrossTenantAccess = services.allowsCrossTenantAccess;
        this.registerTransactionState = services.registerTransactionState;
        this.markStateRestorationFailure = services.markStateRestorationFailure;
        this.loadNavigation = services.loadNavigation;
    }

    public get options(): DbSetContext['options'] {
        return this.services.options();
    }

    public get database(): DbSetContext['database'] {
        return this.services.database();
    }

    public get dialect(): DbSetContext['dialect'] {
        return this.services.options().dialect;
    }

    public get valueReader(): DbSetContext['valueReader'] {
        return this.services.options().valueReader;
    }

    public get modelMetadata(): DbSetContext['modelMetadata'] {
        return this.services.model();
    }
}

/** Adapt context-owned runtime services to the narrow contract consumed by DbSet. */
export function createDbSetContextAdapter(options: DbSetContextAdapterOptions): DbSetContext {
    return new RuntimeDbSetContext(options);
}
