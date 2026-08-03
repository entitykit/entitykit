import type { EntityMetadata } from '../model/entity-metadata';
import type { EntityEntry } from './entity-entry';
import {
    cloneEntityValues,
    hasEntityModifications,
    modifiedEntityProperties,
    readEntityValues,
} from './entity-entry-snapshot';
import { EntityState } from './entity-state';
import {
    acceptNavigationSnapshotValues,
    captureNavigation,
    forgetNavigation,
    refreshNavigationSnapshots,
    type NavigationSnapshotValues,
} from './navigation-snapshot';

export class EntityEntryState<TEntity extends object> {
    private snapshot: Record<string, unknown>;
    private readonly loadedNavigations: Set<string> = new Set();

    constructor(
        private readonly metadata: EntityMetadata<TEntity>,
        private readonly entity: TEntity,
        originalValues?: Record<string, unknown>,
    ) {
        this.snapshot = originalValues
            ? cloneEntityValues(metadata, originalValues)
            : readEntityValues(metadata, entity);
    }

    public get originalValues(): Readonly<Record<string, unknown>> {
        return this.snapshot;
    }

    public currentValues(): Record<string, unknown> {
        return readEntityValues(this.metadata, this.entity);
    }

    public modifiedProperties(): string[] {
        return modifiedEntityProperties(this.metadata, this.entity, this.snapshot);
    }

    public detectChanges(state: EntityState): EntityState {
        if (state !== EntityState.Unchanged && state !== EntityState.Modified) {
            return state;
        }

        return hasEntityModifications(this.metadata, this.entity, this.snapshot)
            ? EntityState.Modified
            : EntityState.Unchanged;
    }

    public refresh(values?: Record<string, unknown>): void {
        this.snapshot = values
            ? cloneEntityValues(this.metadata, values)
            : readEntityValues(this.metadata, this.entity);
    }

    public accept(entry: EntityEntry<object>): void {
        this.snapshot = readEntityValues(this.metadata, this.entity);
        refreshNavigationSnapshots(entry);
    }

    public acceptPersisted(
        entry: EntityEntry<object>,
        values: Record<string, unknown>,
        navigations: NavigationSnapshotValues,
    ): void {
        this.snapshot = cloneEntityValues(this.metadata, values);
        acceptNavigationSnapshotValues(entry, navigations);
    }

    public markNavigationLoaded(
        entry: EntityEntry<object>,
        property: string,
    ): void {
        this.loadedNavigations.add(property);
        captureNavigation(entry, property);
    }

    public markNavigationNotLoaded(
        entry: EntityEntry<object>,
        property: string,
    ): void {
        this.loadedNavigations.delete(property);
        forgetNavigation(entry, property);
    }

    public isNavigationLoaded(property: string): boolean {
        return this.loadedNavigations.has(property);
    }

    public loadedNavigationProperties(): readonly string[] {
        return Array.from(this.loadedNavigations).sort();
    }
}
