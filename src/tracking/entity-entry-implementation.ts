import type { EntityMetadata } from '../model/entity-metadata';
import type { PropertySelector } from '../model/model-property-selector';
import type { EntityDatabaseValues } from './entity-database-values';
import { entityEntryConcurrency } from './entity-entry-concurrency';
import type { ConcurrencyResolutionStrategy } from './entity-entry-concurrency-types';
import { EntityEntryState } from './entity-entry-state';
import { EntityState } from './entity-state';
import { collectionEntry, referenceEntry, type CollectionNavigationEntry, type EntityNavigationLoader, type ReferenceNavigationEntry } from './navigation-entry';
import type { NavigationSnapshotValues } from './navigation-snapshot';
export { cloneSnapshotValue } from './entity-entry-snapshot';
export class EntityEntry<TEntity extends object> {
    private readonly trackedState: EntityEntryState<TEntity>;
    private navigationLoader?: EntityNavigationLoader;
    constructor(
        public readonly entity: TEntity,
        public readonly metadata: EntityMetadata<TEntity>,
        state: EntityState,
        originalValues?: Record<string, unknown>,
    ) {
        this.trackedState = new EntityEntryState(
            this,
            metadata,
            entity,
            state,
            originalValues,
        );
    }
    public get state(): EntityState {
        return this.trackedState.state;
    }
    public transitionToState(state: EntityState): void {
        this.trackedState.transitionTo(state);
    }
    public get originalValues(): Readonly<Record<string, unknown>> {
        return this.trackedState.originalValues;
    }
    public get keyValue(): unknown {
        return this.metadata.hasCompositeKey
            ? this.metadata.getKeyValues(this.entity)
            : this.metadata.getKeyValue(this.entity);
    }
    public currentValues(): Record<string, unknown> {
        return this.trackedState.currentValues();
    }
    public setStateFromCapturedValues(
        values: Readonly<Record<string, unknown>>,
    ): EntityState {
        return this.trackedState.setStateFromCapturedValues(values);
    }
    public modifiedProperties(): string[] {
        return this.trackedState.modifiedProperties();
    }
    public detectChanges(): void {
        this.trackedState.detectChanges();
    }
    public refreshOriginalValues(values?: Record<string, unknown>): void {
        this.trackedState.refresh(values);
    }
    public acceptChanges(): void {
        this.trackedState.accept(this as unknown as EntityEntry<object>);
    }
    public acceptPersistedValues(
        values: Record<string, unknown>,
        navigations: NavigationSnapshotValues,
        state: EntityState = EntityState.Unchanged,
    ): void {
        this.trackedState.acceptPersisted(
            this as unknown as EntityEntry<object>,
            values,
            navigations,
            state,
        );
    }
    public restoreTrackedValues(
        values: Record<string, unknown>,
        navigations: NavigationSnapshotValues,
        state: EntityState,
    ): void {
        this.trackedState.acceptPersisted(
            this as unknown as EntityEntry<object>,
            values,
            navigations,
            state,
        );
    }
    public markDeleted(): void {
        this.trackedState.transitionTo(EntityState.Deleted);
    }
    public markNavigationLoaded(navigationProperty: string): void {
        this.trackedState.markNavigationLoaded(
            this as unknown as EntityEntry<object>,
            navigationProperty,
        );
    }

    public markNavigationNotLoaded(navigationProperty: string): void {
        this.trackedState.markNavigationNotLoaded(
            this as unknown as EntityEntry<object>,
            navigationProperty,
        );
    }
    public isNavigationLoaded(navigationProperty: string): boolean {
        return this.trackedState.isNavigationLoaded(navigationProperty);
    }
    public loadedNavigations(): readonly string[] {
        return this.trackedState.loadedNavigationProperties();
    }

    public useNavigationLoader(loader: EntityNavigationLoader): this {
        this.navigationLoader = loader;
        return this;
    }

    public async getDatabaseValues(): Promise<
        EntityDatabaseValues<TEntity> | null
    > {
        return entityEntryConcurrency(this).getDatabaseValues();
    }

    public async reload(): Promise<boolean> {
        return entityEntryConcurrency(this).reload();
    }

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
        this.trackedState.detach();
    }

    private requireNavigationLoader(): EntityNavigationLoader {
        if (!this.navigationLoader) {
            throw new Error(`EntityEntry for '${this.metadata.entityName}' is not associated with a DbContext navigation loader.`);
        }

        return this.navigationLoader;
    }
}
