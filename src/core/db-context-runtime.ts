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

/** Lifecycle, metadata, and set ownership shared by the focused context stages. */
export abstract class DbContextRuntime {
    private readonly state = new DbContextState();
    private disposePromise?: Promise<void>;
    public readonly changeTracker = new ChangeTracker();
    private readonly lazyNavigation = new LazyNavigationCoordinator(
        this,
        operation => {
            this.assertNotDisposed(operation);
        },
    );

    protected abstract get transactionDepth(): number;
    public abstract loadNavigation<TEntity extends object>(
        entry: EntityEntry<TEntity>,
        navigationProperty: string
    ): Promise<unknown>;
    public abstract applyQueryFilters<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        query: QueryModel<TEntity>
    ): QueryModel<TEntity>;

    public get options(): DbContextOptions {
        return this.state.options;
    }
    protected get databaseConnection(): DatabaseConnection {
        this.assertNotDisposed('database connection access');
        return this.state.database;
    }

    public get dialect(): SqlDialect {
        return this.options.dialect;
    }
    public get valueReader(): StoreValueReader | undefined {
        return this.options.valueReader;
    }
    public get modelMetadata(): Model {
        return this.state.model;
    }
    protected configure(options: DbContextOptionsBuilder): void {
        void options;
    }
    protected model(model: ModelBuilder): void {
        void model;
    }

    public entry<TEntity extends object>(entity: TEntity): EntityEntry<TEntity> | undefined {
        return this.changeTracker.entry(entity)?.useNavigationLoader(this);
    }

    public set<TEntity extends object>(
        entityType: EntityConstructor<TEntity>,
    ): DbSetContract<TEntity> {
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
                applyQueryFilters: (metadata, query) => this.applyQueryFilters(metadata, query),
                currentTenantIdForWrites: () => this.currentTenantIdForWrites(),
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

    public currentTenantIdForWrites(): unknown {
        return this.currentTenantId();
    }

    public async dispose(): Promise<void> {
        if (this.disposePromise) {
            await this.disposePromise;
            return;
        }
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
        return this.options.auditing?.now?.() ?? new Date();
    }

    protected currentAuditUserId(): unknown {
        return this.options.auditing?.currentUserId?.();
    }

    protected currentTenantId(): unknown {
        return this.options.tenantScope?.currentTenantId();
    }

    protected cancelAddedEntity(entity: object): void {
        this.changeTracker.detach(entity);
    }

    protected initialize(): void {
        initializeDbContext(
            this.state,
            this.changeTracker,
            this.lazyNavigation,
            builder => {
                this.configure(builder);
            },
            builder => {
                this.model(builder);
            },
        );
    }

}
