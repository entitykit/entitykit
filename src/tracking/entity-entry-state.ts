import type { EntityMetadata } from '../model/entity-metadata';
import type { EntityEntry } from './entity-entry';
import { cloneEntityValues, hasEntityModifications, hasEntityValueModifications, modifiedEntityProperties, readEntityValues } from './entity-entry-snapshot';
import { cloneBoundEntityValues } from './bound-entity-value-clone';
import { EntityState } from './entity-state';
import { assertEntityEntryStateMutation } from './entity-entry-mutation-guard';
import { acceptNavigationSnapshotValues, refreshNavigationSnapshots, type NavigationSnapshotValues } from './navigation-snapshot';
import { captureBoundEntityValues, cloneBoundValues } from './bound-value-snapshot';
import { EntityEntryNavigationState } from './entity-entry-navigation-state';
import { captureInitialTrackedEntrySnapshot } from './initial-tracked-entry-snapshot';
export class EntityEntryState<TEntity extends object> {
    private snapshot: Record<string, unknown>;
    private boundSnapshot: Record<string, unknown>;
    private readonly navigations = new EntityEntryNavigationState();
    constructor(
        private readonly owner: EntityEntry<TEntity>,
        private readonly metadata: EntityMetadata<TEntity>,
        private readonly entity: TEntity,
        private currentState: EntityState,
        originalValues?: Record<string, unknown>,
        originalBoundValues?: Record<string, unknown>,
    ) {
        const captured = captureInitialTrackedEntrySnapshot(
            entity, metadata, originalValues, originalBoundValues,
        );
        this.snapshot = captured.values;
        this.boundSnapshot = captured.boundValues;
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
    public refreshPersisted(
        values: Record<string, unknown>,
        boundValues: Record<string, unknown>,
    ): void {
        this.snapshot = cloneBoundEntityValues(
            this.metadata,
            values,
            boundValues,
        );
        this.boundSnapshot = cloneBoundValues(boundValues);
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
        this.snapshot = cloneBoundEntityValues(this.metadata, values, boundValues);
        this.boundSnapshot = cloneBoundValues(boundValues);
        acceptNavigationSnapshotValues(entry, navigations);
        this.currentState = state;
    }
    public detach(): void {
        this.currentState = EntityState.Detached;
    }

    public markNavigationLoaded(
        entry: EntityEntry<object>, property: string,
    ): void {
        this.navigations.markLoaded(entry, property);
    }

    public markNavigationNotLoaded(
        entry: EntityEntry<object>, property: string,
    ): void {
        this.navigations.markNotLoaded(entry, property);
    }

    public isNavigationLoaded(property: string): boolean {
        return this.navigations.isLoaded(property);
    }

    public loadedNavigationProperties(): readonly string[] {
        return this.navigations.properties();
    }
}
