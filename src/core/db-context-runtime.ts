import type { DbContextOptionsBuilder } from './context-options/db-context-options-builder';
import type { DbContextOptions } from './context-options/db-context-option-types';
import type { EntityConstructor } from '../types';
import { ContextDisposedError } from '../errors/runtime-errors';
import { DbSet } from './db-set';
import type { DbSet as DbSetContract } from './db-set-types';
import type { Model } from '../model/model';
import type { EntityMetadata } from '../model/entity-metadata';
import type { ModelBuilder } from '../model/model-builder';
import type { QueryModel } from '../query/query-model';
import { ChangeTracker } from '../tracking/change-tracker';
import { initializeDbContext } from './db-context-initializer';
import { LazyNavigationCoordinator } from './lazy-navigation-coordinator';
import { DbContextState } from './db-context-state';
import type { DatabaseConnection } from '../storage/database-connection';
import type { EntityEntry } from '../tracking/entity-entry';
import type { SqlDialect } from '../sql/sql-dialect';
import type { StoreValueReader } from '../storage/store-value-reader';
import { createDbSetContextAdapter } from './db-set-context-adapter';
import { readSynchronousScopeValue } from './synchronous-scope-value';
import { readSynchronousDate } from '../synchronous-value';
import type { QueryFilterOperation } from './query-filter-operation';
export abstract class DbContextRuntime {
    private readonly state = new DbContextState();
    private disposePromise?: Promise<void>;
    public readonly changeTracker = new ChangeTracker();
    private readonly lazyNavigation = new LazyNavigationCoordinator(
        this, this.assertNotDisposed.bind(this),
    );
    protected abstract get transactionDepth(): number;
    protected abstract registerTransactionState(
        afterCommit: () => void, afterRollback: () => void): void;
    public abstract loadNavigation<TEntity extends object>(
        entry: EntityEntry<TEntity>,
        navigationProperty: string
    ): Promise<unknown>;
    public abstract applyQueryFilters<TEntity extends object>(metadata: EntityMetadata<TEntity>, query: QueryModel<TEntity>): QueryModel<TEntity>;
    public abstract beginQueryOperation(): QueryFilterOperation;
    public get options(): DbContextOptions {
        this.ensureInitialized();
        return this.state.options;
    }
    protected get databaseConnection(): DatabaseConnection {
        this.assertNotDisposed('database connection access');
        this.ensureInitialized();
        return this.state.database;
    }
    public get dialect(): SqlDialect {
        return this.options.dialect;
    }
    public get valueReader(): StoreValueReader | undefined {
        return this.options.valueReader;
    }
    public get modelMetadata(): Model {
        this.ensureInitialized();
        return this.state.model;
    }
    protected configure(options: DbContextOptionsBuilder): unknown {
        void options;
        return undefined;
    }
    protected model(model: ModelBuilder): unknown {
        void model;
        return undefined;
    }
    public entry<TEntity extends object>(entity: TEntity): EntityEntry<TEntity> | undefined {
        return this.changeTracker.entry(entity)?.useNavigationLoader(this);
    }
    public set<TEntity extends object, TKey extends readonly unknown[] = readonly unknown[]>(
        entityType: EntityConstructor<TEntity>,
    ): DbSetContract<TEntity, TKey> {
        const existing = this.state.findSet(entityType);
        if (existing) {
            return existing;
        }
        const created: DbSet<TEntity> = new DbSet(
            createDbSetContextAdapter({
                options: () => this.options,
                database: () => this.databaseConnection,
                model: () => this.modelMetadata,
                changeTracker: this.changeTracker,
                assertCanQuery: operation => {
                    this.assertNotDisposed(operation);
                    this.ensureInitialized();
                    void this.state.database;
                },
                applyQueryFilters: (metadata, query) => this.applyQueryFilters(metadata, query),
                beginQueryOperation: () => this.beginQueryOperation(),
                currentTenantIdForWrites: () => this.currentTenantId(),
                allowsCrossTenantAccess: () =>
                    this.options.tenantScope?.allowCrossTenantAccess === true,
                registerTransactionState: this.registerTransactionState.bind(this),
                loadNavigation: async (entry, navigationProperty) =>
                    this.loadNavigation(entry, navigationProperty),
            }), entityType,
            entity => {
                this.cancelAddedEntity(entity);
            },
        );
        this.state.addSet(entityType, created);
        return created;
    }
    public async dispose(): Promise<void> {
        if (this.disposePromise) {
            await this.disposePromise;
            return;
        }
        this.ensureInitialized();
        this.state.assertCanDispose(this.transactionDepth);
        this.state.disposed = true;
        this.disposePromise = this.state.disposeConnection();
        await this.disposePromise;
    }
    protected assertNotDisposed(operation: string): void {
        if (this.state.disposed) {
            throw new ContextDisposedError(operation);
        }
    }
    protected currentAuditTimestamp(): Date {
        return readSynchronousDate(this.options.auditing?.now, 'The audit clock') ?? new Date();
    }
    protected currentAuditUserId(): unknown {
        return readSynchronousScopeValue(this.options.auditing?.currentUserId,
            'The current audit user callback',
        );
    }
    protected currentTenantId(): unknown {
        return readSynchronousScopeValue(this.options.tenantScope?.currentTenantId,
            'The current tenant callback',
        );
    }
    protected cancelAddedEntity(entity: object): void {
        this.changeTracker.detach(entity);
    }
    protected initialize(): void {
        initializeDbContext(
            this.state,
            this.changeTracker,
            this.lazyNavigation,
            this.configure.bind(this),
            this.model.bind(this),
        );
    }
    private ensureInitialized(): void {
        if (!this.state.initialized) {
            this.initialize();
        }
    }
}
