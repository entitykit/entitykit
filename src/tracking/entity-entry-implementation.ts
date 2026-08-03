import type { EntityMetadata } from '../model/entity-metadata';
import type { PropertySelector } from '../model/model-property-selector';
import type { EntityDatabaseValues } from './entity-database-values';
import { entityEntryConcurrency } from './entity-entry-concurrency';
import type { ConcurrencyResolutionStrategy } from './entity-entry-concurrency-types';
import { EntityState } from './entity-state';
import {
    cloneEntityValues,
    hasEntityModifications,
    modifiedEntityProperties,
    readEntityValues,
} from './entity-entry-snapshot';
import { collectionEntry, referenceEntry, type CollectionNavigationEntry, type EntityNavigationLoader, type ReferenceNavigationEntry } from './navigation-entry';
import {
    acceptNavigationSnapshotValues,
    captureNavigation,
    forgetNavigation,
    refreshNavigationSnapshots,
    type NavigationSnapshotValues,
} from './navigation-snapshot';

export { cloneSnapshotValue } from './entity-entry-snapshot';

export class EntityEntry<TEntity extends object> {
    private snapshot: Record<string, unknown>;
    private readonly loadedNavigationProperties: Set<string> = new Set();
    private navigationLoader?: EntityNavigationLoader;

    constructor(
        public readonly entity: TEntity,
        public readonly metadata: EntityMetadata<TEntity>,
        public state: EntityState,
        originalValues?: Record<string, unknown>,
    ) {
        this.snapshot = originalValues
            ? cloneEntityValues(this.metadata, originalValues)
            : readEntityValues(this.metadata, this.entity);
    }

    public get originalValues(): Readonly<Record<string, unknown>> {
        return this.snapshot;
    }

    /**
   * The entity's key value, used for reporting and save ordering.
   *
   * A composite key reports the tuple of values in declaration order.
   */
    public get keyValue(): unknown {
        return this.metadata.hasCompositeKey
            ? this.metadata.getKeyValues(this.entity)
            : this.metadata.getKeyValue(this.entity);
    }

    public currentValues(): Record<string, unknown> {
        return readEntityValues(this.metadata, this.entity);
    }

    public modifiedProperties(): string[] {
        return modifiedEntityProperties(this.metadata, this.entity, this.snapshot);
    }

    public detectChanges(): void {
        if (this.state !== EntityState.Unchanged && this.state !== EntityState.Modified) {
            return;
        }

        this.state = hasEntityModifications(
            this.metadata,
            this.entity,
            this.snapshot,
        )
            ? EntityState.Modified
            : EntityState.Unchanged;
    }

    public refreshOriginalValues(values?: Record<string, unknown>): void {
        this.snapshot = values
            ? cloneEntityValues(this.metadata, values)
            : readEntityValues(this.metadata, this.entity);
    }

    public acceptChanges(): void {
        this.snapshot = readEntityValues(this.metadata, this.entity);
        refreshNavigationSnapshots(this as unknown as EntityEntry<object>);
        this.state = EntityState.Unchanged;
    }

    /** Accept only the mapped and relationship values an executed plan wrote. */
    public acceptPersistedValues(
        values: Record<string, unknown>,
        navigations: NavigationSnapshotValues,
    ): void {
        this.snapshot = cloneEntityValues(this.metadata, values);
        acceptNavigationSnapshotValues(
            this as unknown as EntityEntry<object>,
            navigations,
        );
        this.state = EntityState.Unchanged;
    }

    public markDeleted(): void {
        this.state = EntityState.Deleted;
    }

    public markNavigationLoaded(navigationProperty: string): void {
        this.loadedNavigationProperties.add(navigationProperty);
        captureNavigation(this as unknown as EntityEntry<object>, navigationProperty);
    }

    public markNavigationNotLoaded(navigationProperty: string): void {
        this.loadedNavigationProperties.delete(navigationProperty);
        forgetNavigation(this as unknown as EntityEntry<object>, navigationProperty);
    }
    public isNavigationLoaded(navigationProperty: string): boolean {
        return this.loadedNavigationProperties.has(navigationProperty);
    }
    public loadedNavigations(): readonly string[] {
        return Array.from(this.loadedNavigationProperties).sort();
    }

    public useNavigationLoader(loader: EntityNavigationLoader): this {
        this.navigationLoader = loader;
        return this;
    }

    /** Read current persisted mapped values without changing this entry. */
    public async getDatabaseValues(): Promise<
        EntityDatabaseValues<TEntity> | null
    > {
        return entityEntryConcurrency(this).getDatabaseValues();
    }

    /** Replace mapped values with the database row, or detach if deleted. */
    public async reload(): Promise<boolean> {
        return entityEntryConcurrency(this).reload();
    }

    /** Explicitly choose which side wins an optimistic-concurrency conflict. */
    public async resolveConcurrency(
        strategy: ConcurrencyResolutionStrategy,
        databaseValues?: EntityDatabaseValues<TEntity>,
    ): Promise<EntityDatabaseValues<TEntity> | null> {
        return entityEntryConcurrency(this).resolve(strategy, databaseValues);
    }

    public reference<TNavigation>(selector: PropertySelector<TEntity, TNavigation>): ReferenceNavigationEntry<TEntity, NonNullable<TNavigation>> {
        return referenceEntry(this, selector, this.requireNavigationLoader());
    }

    public collection<TCollection>(selector: PropertySelector<TEntity, TCollection>): CollectionNavigationEntry<TEntity, NonNullable<TCollection> extends ReadonlyArray<infer TElement> ? NonNullable<TElement> : never> {
        return collectionEntry(this, selector, this.requireNavigationLoader());
    }

    public markDetached(): void {
        this.state = EntityState.Detached;
    }

    private requireNavigationLoader(): EntityNavigationLoader {
        if (!this.navigationLoader) {
            throw new Error(`EntityEntry for '${this.metadata.entityName}' is not associated with a DbContext navigation loader.`);
        }

        return this.navigationLoader;
    }
}
