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
import type { SavePlanEntry } from './save-plan';
import { registerContextMigrationHost } from '../migrations/context-migration-registry';

export type { SavePlanEntry } from './save-plan';

/**
 * Base class for an EntityKit unit of work.
 *
 * Derive from `DbContext`, declare `DbSet` properties, configure the provider in
 * `configure(...)`, and describe the model in `model(...)` with the fluent
 * `ModelBuilder`.
 *
 * The public class delegates to focused internal stages for lifecycle, queries,
 * migrations, raw SQL, relationships, and saving.
 */
export abstract class DbContext {
    private readonly contextHost: DbContextHost;
    private databaseFacade?: DatabaseFacade;

    constructor() {
        this.contextHost = new DbContextHost(
            options => this.configure(options),
            model => this.model(model),
        );
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
        return this.contextHost.changeTracker;
    }
    /** High-level database operations and the explicit connection escape hatch. */
    public get database(): DatabaseFacade {
        this.databaseFacade ??=
            createDbContextDatabaseFacade(this.contextHost);
        return this.databaseFacade;
    }
    /** Return the tracked query and mutation gateway for an entity type. */
    public set<TEntity extends object, TKey extends readonly unknown[] = readonly unknown[]>(
        entityType: EntityConstructor<TEntity>,
    ): DbSet<TEntity, TKey> {
        return this.contextHost.set<TEntity, TKey>(entityType);
    }
    /** Return the tracked entry for an entity, or `undefined` when it is not tracked. */
    public entry<TEntity extends object>(
        entity: TEntity,
    ): EntityEntry<TEntity> | undefined {
        return this.contextHost.entry(entity);
    }
    /** Explicitly load one configured navigation for a tracked entity. */
    public async loadNavigation<TEntity extends object>(
        entry: EntityEntry<TEntity>,
        navigationProperty: string,
    ): Promise<unknown> {
        return this.contextHost.loadNavigation(entry as never, navigationProperty);
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
