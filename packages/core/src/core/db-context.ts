import type { DatabaseFacade } from './database-facade-types';
import type { DbContextOptionsBuilder } from './public-db-context-options';
import { createDbContextDatabaseFacade } from './db-context-database-facade';
import { DbContextHost } from './db-context-host';
import type { PropertySelector } from '../model/model-property-selector';
import type { ModelBuilder } from '../model/model-builder-types';
import type { DatabaseOperationOptions, TransactionOptions } from '../storage/database-connection';
import type { ChangeTracker } from '../tracking/change-tracker-types';
import type { EntityEntry } from '../tracking/entity-entry-types';
import type { SavePlanEntry } from './save-plan';
import { registerContextMigrationHost } from '../migrations/context-migration-registry';
import { DbContextPublicTracking } from './db-context-public-tracking';
import { DbContextSets } from './db-context-sets';
import type { DatabaseDataSource } from '../storage/database-data-source';
export type { RelationshipSavePlanPair, SavePlanEntry } from './save-plan';
/** A unit of work with explicitly configured providers, entity mapping, and saving. */
export abstract class DbContext extends DbContextSets {
    private readonly contextHost: DbContextHost;
    private readonly publicTracking: DbContextPublicTracking;
    private databaseFacade?: DatabaseFacade;
    /** Create a context, optionally backed by an application-scoped data source. */
    constructor(dataSource?: DatabaseDataSource) {
        super(() => this.contextHost);
        this.contextHost = new DbContextHost(
            options => {
                if (dataSource !== undefined) options.useDataSource(dataSource);
                return this.configure(options);
            },
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
    /**
     * Customize options after selecting a constructor-supplied source.
     * No call to DbContext.configure() is needed for source selection.
     * Call super.configure(options) to retain an intermediate base class's configuration.
     */
    protected configure(options: DbContextOptionsBuilder): unknown {
        void options;
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
    /** Return the tracked entry for an entity, or `undefined` when it is not tracked. */
    public entry<TEntity extends object>(
        entity: TEntity,
    ): EntityEntry<TEntity> | undefined {
        return this.publicTracking.entry(entity);
    }
    /** Return this context's tracked entry, or throw EntityNotTrackedError. Executes no SQL. */
    public entryOrThrow<TEntity extends object>(entity: TEntity): EntityEntry<TEntity> {
        return this.publicTracking.entryOrThrow(entity);
    }
    /** Load a configured navigation for a persisted, tracked entity; may execute SQL. */
    public async loadNavigation<TEntity extends object>(
        entry: EntityEntry<TEntity>,
        navigationProperty: string,
    ): Promise<unknown> {
        return this.contextHost.loadNavigation(
            this.publicTracking.internalEntry(entry),
            navigationProperty,
        );
    }
    /** Execute the tracked save pipeline, accept successful changes, and return the affected row count. */
    public async saveChanges(options?: DatabaseOperationOptions): Promise<number> {
        return this.contextHost.saveChanges(options);
    }
    /**
     * Abandon tracked entities and pending relationship work. Executes no SQL.
     * Object property values are not reverted. Cannot run during saveChanges().
     */
    public clearTracking(): void {
        this.contextHost.clearTracking();
    }
    /** @deprecated Use clearTracking(); clearing tracking does not revert objects. */
    public clearChanges(): void {
        this.clearTracking();
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
    /** Stage a many-to-many link between tracked entities. Executes no SQL until saveChanges(). */
    public link<TEntity extends object, TTarget extends object>(
        source: TEntity,
        navigationSelector: PropertySelector<TEntity, readonly TTarget[] | TTarget[]>,
        target: TTarget,
    ): void {
        this.contextHost.link(source, navigationSelector, target);
    }
    /** Stage removal of a many-to-many link. Executes no SQL until saveChanges(). */
    public unlink<TEntity extends object, TTarget extends object>(
        source: TEntity,
        navigationSelector: PropertySelector<TEntity, readonly TTarget[] | TTarget[]>,
        target: TTarget,
    ): void {
        this.contextHost.unlink(source, navigationSelector, target);
    }
    /** Release this context's connection and tracking; does not save pending changes or dispose a shared source. */
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
