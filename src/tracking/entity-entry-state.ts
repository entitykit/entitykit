import type { EntityMetadata } from '../model/entity-metadata';
import type { EntityEntry } from './entity-entry';
import {
    cloneEntityValues,
    hasEntityModifications,
    modifiedEntityProperties,
    readEntityValues,
} from './entity-entry-snapshot';
import { EntityState } from './entity-state';
import { assertEntityEntryStateMutation } from './entity-entry-mutation-guard';
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
        private readonly owner: EntityEntry<TEntity>,
        private readonly metadata: EntityMetadata<TEntity>,
        private readonly entity: TEntity,
        private currentState: EntityState,
        originalValues?: Record<string, unknown>,
    ) {
        this.snapshot = originalValues
            ? cloneEntityValues(metadata, originalValues)
            : readEntityValues(metadata, entity);
    }

    public get state(): EntityState {
        return this.currentState;
    }

    public set state(state: EntityState) {
        if (state !== this.currentState) {
            assertEntityEntryStateMutation(this.owner);
            this.currentState = state;
        }
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

    public detectChanges(): void {
        if (
            this.currentState !== EntityState.Unchanged &&
            this.currentState !== EntityState.Modified
        ) {
            return;
        }

        this.currentState = hasEntityModifications(this.metadata, this.entity, this.snapshot)
            ? EntityState.Modified
            : EntityState.Unchanged;
    }

    public refresh(values?: Record<string, unknown>): void {
        this.snapshot = values
            ? cloneEntityValues(this.metadata, values)
            : readEntityValues(this.metadata, this.entity);
    }

    public accept(
        entry: EntityEntry<object>,
        state: EntityState = EntityState.Unchanged,
    ): void {
        this.snapshot = readEntityValues(this.metadata, this.entity);
        refreshNavigationSnapshots(entry);
        this.currentState = state;
    }

    public acceptPersisted(
        entry: EntityEntry<object>,
        values: Record<string, unknown>,
        navigations: NavigationSnapshotValues,
        state: EntityState = EntityState.Unchanged,
    ): void {
        this.snapshot = cloneEntityValues(this.metadata, values);
        acceptNavigationSnapshotValues(entry, navigations);
        this.currentState = state;
    }

    public detach(): void {
        this.currentState = EntityState.Detached;
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
