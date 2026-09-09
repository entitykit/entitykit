import type { PropertySelector } from '../model/model-property-selector';
import type { EntityDatabaseValues } from './entity-database-values';
import type { ConcurrencyResolutionStrategy } from './entity-entry-concurrency-types';
import type { EntityState } from './entity-state';
import type {
    CollectionNavigationEntry,
    ReferenceNavigationEntry,
} from './navigation-entry-types';

/** Application-facing state and recovery operations for one tracked entity. */
export interface EntityEntry<TEntity extends object> {
    /** The actual tracked domain object. */ readonly entity: TEntity;
    /** Current tracking state; detectChanges() refreshes it after scalar edits. */ readonly state: EntityState;
    /** Tracked identity value; composite keys use their mapped key tuple. */ readonly keyValue: unknown;
    /** An independent snapshot of mapped values at the accepted baseline. */ readonly originalValues: Readonly<Record<string, unknown>>;
    /** Read current mapped scalar values without executing SQL. */ currentValues(): Record<string, unknown>;
    /** Return mapped property names that differ from the original snapshot. */ modifiedProperties(): string[];
    /** Compare mapped values with the baseline and update this entry's state. Executes no SQL. */ detectChanges(): void;
    /** Query stored scalar values without changing this object; return null if the persisted row is absent. */ getDatabaseValues(): Promise<EntityDatabaseValues<TEntity> | null>;
    /** Query and replace scalar values and their baseline. Return false and detach if the row is absent. */ reload(): Promise<boolean>;
    /** Apply clientWins or databaseWins using a supplied snapshot or a database read. Does not save changes. */ resolveConcurrency(
        strategy: ConcurrencyResolutionStrategy,
        databaseValues?: EntityDatabaseValues<TEntity>,
    ): Promise<EntityDatabaseValues<TEntity> | null>;
    /** Return an explicit-loading handle for a mapped reference. Creating the handle executes no SQL. */ reference<TNavigation>(
        selector: PropertySelector<TEntity, TNavigation>,
    ): ReferenceNavigationEntry<NonNullable<TNavigation>>;
    /** Return an explicit-loading handle for a mapped collection. Creating the handle executes no SQL. */ collection<TCollection>(
        selector: PropertySelector<TEntity, TCollection>,
    ): CollectionNavigationEntry<
        NonNullable<TCollection> extends ReadonlyArray<infer TElement>
            ? NonNullable<TElement>
            : never
    >;
    /** Return whether EntityKit has loaded this navigation; initialized values alone do not establish loading. */ isNavigationLoaded(navigationProperty: string): boolean;
    /** Return the names of deliberately loaded navigations. Executes no SQL. */ loadedNavigations(): readonly string[];
}
