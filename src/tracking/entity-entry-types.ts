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
    /** The entity. */ readonly entity: TEntity;
    /** The state. */ state: EntityState;
    /** The key value. */ readonly keyValue: unknown;
    /** The original values. */ readonly originalValues: Readonly<Record<string, unknown>>;
    /** Perform the current values operation. */ currentValues(): Record<string, unknown>;
    /** Perform the modified properties operation. */ modifiedProperties(): string[];
    /** Perform the detect changes operation. */ detectChanges(): void;
    /** Return database values. */ getDatabaseValues(): Promise<EntityDatabaseValues<TEntity> | null>;
    /** Perform the reload operation. */ reload(): Promise<boolean>;
    /** Resolve concurrency. */ resolveConcurrency(
        strategy: ConcurrencyResolutionStrategy,
        databaseValues?: EntityDatabaseValues<TEntity>,
    ): Promise<EntityDatabaseValues<TEntity> | null>;
    /** Perform the reference operation. */ reference<TNavigation>(
        selector: PropertySelector<TEntity, TNavigation>,
    ): ReferenceNavigationEntry<NonNullable<TNavigation>>;
    /** Perform the collection operation. */ collection<TCollection>(
        selector: PropertySelector<TEntity, TCollection>,
    ): CollectionNavigationEntry<
        NonNullable<TCollection> extends ReadonlyArray<infer TElement>
            ? NonNullable<TElement>
            : never
    >;
    /** Configure navigation loaded and return this builder. */ isNavigationLoaded(navigationProperty: string): boolean;
    /** Perform the loaded navigations operation. */ loadedNavigations(): readonly string[];
}
