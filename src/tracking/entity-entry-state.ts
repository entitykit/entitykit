import type { EntityMetadata } from '../model/entity-metadata';
import type { EntityEntry } from './entity-entry';
import {
    cloneEntityValues,
    hasEntityModifications,
    hasEntityValueModifications,
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
import {
    captureBoundEntityValues,
    cloneBoundValues,
} from './bound-value-snapshot';

export class EntityEntryState<TEntity extends object> {
    private snapshot: Record<string, unknown>;
    private boundSnapshot: Record<string, unknown>;
    private readonly loadedNavigations: Set<string> = new Set();

    constructor(
        private readonly owner: EntityEntry<TEntity>,
        private readonly metadata: EntityMetadata<TEntity>,
        private readonly entity: TEntity,
        private currentState: EntityState,
        originalValues?: Record<string, unknown>,
        originalBoundValues?: Record<string, unknown>,
    ) {
        this.snapshot = originalValues
            ? cloneEntityValues(metadata, originalValues)
            : readEntityValues(metadata, entity);
        this.boundSnapshot = originalBoundValues
            ? cloneBoundValues(originalBoundValues)
            : captureBoundEntityValues(metadata, this.snapshot);
    }

    public get state(): EntityState {
        return this.currentState;
    }

    public transitionTo(state: EntityState): void {
        if (state !== this.currentState) {
            assertEntityEntryStateMutation(this.owner);
            this.currentState = state;
        }
    }

    public get originalValues(): Readonly<Record<string, unknown>> {
        return this.snapshot;
    }

    public get originalBoundValues(): Readonly<Record<string, unknown>> {
        return this.boundSnapshot;
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

    public setStateFromCapturedValues(
        values: Readonly<Record<string, unknown>>,
    ): EntityState {
        if (
            this.currentState === EntityState.Unchanged ||
            this.currentState === EntityState.Modified
        ) {
            this.currentState = hasEntityValueModifications(
                this.metadata,
                values,
                this.snapshot,
            )
                ? EntityState.Modified
                : EntityState.Unchanged;
        }
        return this.currentState;
    }

    public refresh(values?: Record<string, unknown>): void {
        this.snapshot = values
            ? cloneEntityValues(this.metadata, values)
            : readEntityValues(this.metadata, this.entity);
        this.boundSnapshot = captureBoundEntityValues(
            this.metadata,
            this.snapshot,
        );
    }

    public accept(
        entry: EntityEntry<object>,
        state: EntityState = EntityState.Unchanged,
    ): void {
        this.snapshot = readEntityValues(this.metadata, this.entity);
        this.boundSnapshot = captureBoundEntityValues(
            this.metadata,
            this.snapshot,
        );
        refreshNavigationSnapshots(entry);
        this.currentState = state;
    }

    public acceptPersisted(
        entry: EntityEntry<object>,
        values: Record<string, unknown>,
        boundValues: Record<string, unknown>,
        navigations: NavigationSnapshotValues,
        state: EntityState = EntityState.Unchanged,
    ): void {
        this.snapshot = cloneEntityValues(this.metadata, values);
        this.boundSnapshot = cloneBoundValues(boundValues);
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
