import type { DatabaseFacade } from './database-facade-types';
import type { DbContextOptionsBuilder } from './public-db-context-options';
import { createDbContextDatabaseFacade } from './db-context-database-facade';
import { DbContextHost } from './db-context-host';
import type { PropertySelector } from '../model/model-property-selector';
import type { ModelBuilder } from '../model/model-builder-types';
import type { DatabaseOperationOptions, TransactionOptions } from '../storage/database-connection';
import type { ChangeTracker } from '../tracking/change-tracker-types';
import type { EntityEntry } from '../tracking/entity-entry-types';
import type { EntityConstructor } from '../types';
import type { DbSet } from './db-set-types';
import type { DbSetCreationOptions, EntityCreationConstructor, EntityCreationFunction, EntityCreationResult, EntityCreationArguments } from './db-set-creation-types';
import { dbSetCreationFactory } from './db-set-create';
import type { SavePlanEntry } from './save-plan';
import { registerContextMigrationHost } from '../migrations/context-migration-registry';
import { DbContextPublicTracking } from './db-context-public-tracking';
import type { DatabaseDataSource } from '../storage/database-data-source';
export type { RelationshipSavePlanPair, SavePlanEntry } from './save-plan';
/** A unit of work with explicitly configured providers, entity mapping, and saving. */
export abstract class DbContext {
    private readonly contextHost: DbContextHost;
    private readonly publicTracking: DbContextPublicTracking;
    private databaseFacade?: DatabaseFacade;
    /** Create a context, optionally backed by an application-scoped data source. */
    constructor(private readonly dataSource?: DatabaseDataSource) {
        this.contextHost = new DbContextHost(
            options => this.configure(options),
            model => this.model(model),
        );
        this.publicTracking = new DbContextPublicTracking(this.contextHost);
        registerContextMigrationHost(this, this.contextHost);
    }
    /** Create and initialize a context; setup runs here because constructors stay synchronous. */
    public static create<TContext extends DbContext, TArguments extends unknown[]>(
        this: new (...arguments_: TArguments) => TContext,
        ...arguments_: TArguments
    ): TContext {
        const context = new this(...arguments_);
        context.initializeContext();
        return context;
    }
    /** Configure the database provider and production options for this context. */
    protected configure(options: DbContextOptionsBuilder): unknown {
        if (this.dataSource !== undefined) {
            options.useDataSource(this.dataSource);
        }
        return undefined;
    }
    /** Configure mapped entity types for this context. */
    protected model(model: ModelBuilder): unknown {
        void model;
        return undefined;
    }
    /** Inspect and manage entities tracked by this context. */
    public get changeTracker(): ChangeTracker {
        return this.publicTracking.changeTracker;
    }
    /** High-level database operations and the explicit connection escape hatch. */
    public get database(): DatabaseFacade {
        this.databaseFacade ??=
            createDbContextDatabaseFacade(this.contextHost);
        return this.databaseFacade;
    }
    /** Bind a creation factory to this gateway; other sets retain their construction policy. */
    public set<TEntity extends object, TFactory extends EntityCreationFunction<NoInfer<TEntity>>, TKey extends readonly unknown[] = readonly unknown[]>(
        entityType: EntityConstructor<TEntity>, options: DbSetCreationOptions<TFactory>,
    ): DbSet<TEntity, TKey, EntityCreationArguments<TFactory>>;
    /** Infer creation arguments from a public constructor. */
    public set<TConstructor extends EntityCreationConstructor, TKey extends readonly unknown[] = readonly unknown[]>(
        entityType: TConstructor,
    ): DbSet<EntityCreationResult<TConstructor>, TKey, EntityCreationArguments<TConstructor>>;
    /** Preserve identity-only registration and existing entity/key type arguments. */
    public set<TEntity extends object, TKey extends readonly unknown[] = readonly unknown[]>(
        entityType: EntityConstructor<TEntity>,
    ): DbSet<TEntity, TKey>;
    public set<TEntity extends object>(
        entityType: EntityConstructor<TEntity>, options?: DbSetCreationOptions<EntityCreationFunction<TEntity>>,
    ): unknown {
        return this.contextHost.set(entityType, dbSetCreationFactory(options));
    }
    /** Return the tracked entry for an entity, or `undefined` when it is not tracked. */
    public entry<TEntity extends object>(
        entity: TEntity,
    ): EntityEntry<TEntity> | undefined {
        return this.publicTracking.entry(entity);
    }
    /** Explicitly load one configured navigation for a tracked entity. */
    public async loadNavigation<TEntity extends object>(
        entry: EntityEntry<TEntity>,
        navigationProperty: string,
    ): Promise<unknown> {
        return this.contextHost.loadNavigation(
            this.publicTracking.internalEntry(entry),
            navigationProperty,
        );
    }
    /** Persist tracked changes and return the affected row count. */
    public async saveChanges(options?: DatabaseOperationOptions): Promise<number> {
        return this.contextHost.saveChanges(options);
    }
    /** Clear every tracked entry without writing changes. */
    public clearChanges(): void {
        this.contextHost.clearChanges();
    }
    /** Describe the writes the next `saveChanges()` call would attempt. */
    public getSavePlan(): readonly SavePlanEntry[] {
        return this.contextHost.getSavePlan();
    }
    /** Render a human-readable, redacted view of the pending save plan. */
    public getSavePlanDebugView(): string {
        return this.contextHost.getSavePlanDebugView();
    }

    /** Run work in a transaction, nesting through savepoints when supported. */
    public async transaction<TResult>(
        work: (context: this) => TResult | Promise<TResult>,
        options?: TransactionOptions,
    ): Promise<TResult> {
        return this.contextHost.transaction(async () => work(this), options);
    }
    /** Add a link between two tracked entities in a many-to-many relationship. */
    public link<TEntity extends object, TTarget extends object>(
        source: TEntity,
        navigationSelector: PropertySelector<TEntity, readonly TTarget[] | TTarget[]>,
        target: TTarget,
    ): void {
        this.contextHost.link(source, navigationSelector, target);
    }
    /** Remove a link between two tracked entities in a many-to-many relationship. */
    public unlink<TEntity extends object, TTarget extends object>(
        source: TEntity,
        navigationSelector: PropertySelector<TEntity, readonly TTarget[] | TTarget[]>,
        target: TTarget,
    ): void {
        this.contextHost.unlink(source, navigationSelector, target);
    }
    /** Release resources owned by this object. */
    public async dispose(): Promise<void> {
        await this.contextHost.dispose();
    }
    /** Dispose the context when used with `await using`. */
    public async [Symbol.asyncDispose](): Promise<void> {
        await this.dispose();
    }
    private initializeContext(): void {
        this.contextHost.initializeContext();
    }
}
import './async-dispose-compat';
