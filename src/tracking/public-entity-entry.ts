import { selectPropertyName } from '../model/model-property-selector';
import type { PropertySelector } from '../model/model-property-selector';
import type { EntityEntry as InternalEntityEntry } from './entity-entry';
import type { EntityEntry } from './entity-entry-types';
import type { EntityDatabaseValues } from './entity-database-values';
import type { ConcurrencyResolutionStrategy } from './entity-entry-concurrency-types';
import type { EntityState } from './entity-state';
import type { EntityNavigationLoader } from './navigation-entry';
import type {
    CollectionNavigationEntry,
    ReferenceNavigationEntry,
} from './navigation-entry-types';
import {
    createPublicCollectionEntry,
    createPublicReferenceEntry,
} from './public-navigation-entry';

interface PublicEntryState<TEntity extends object> {
    readonly internal: InternalEntityEntry<TEntity>;
    loader?: EntityNavigationLoader;
}

interface StoredEntryState {
    readonly internal: object;
    loader?: EntityNavigationLoader;
}

const publicByInternal: WeakMap<object, object> = new WeakMap();
const stateByPublic: WeakMap<object, StoredEntryState> = new WeakMap();

class PublicEntityEntry<TEntity extends object> implements EntityEntry<TEntity> {
    public get entity(): TEntity {
        return state(this).internal.entity;
    }
    public get state(): EntityState {
        return state(this).internal.state;
    }
    public get keyValue(): unknown {
        return state(this).internal.keyValue;
    }
    public get originalValues(): Readonly<Record<string, unknown>> {
        return state(this).internal.originalValues;
    }
    public currentValues(): Record<string, unknown> {
        return state(this).internal.currentValues();
    }
    public modifiedProperties(): string[] {
        return state(this).internal.modifiedProperties();
    }
    public detectChanges(): void {
        state(this).internal.detectChanges();
    }
    public async getDatabaseValues(): Promise<EntityDatabaseValues<TEntity> | null> {
        return state(this).internal.getDatabaseValues();
    }
    public async reload(): Promise<boolean> {
        return state(this).internal.reload();
    }
    public async resolveConcurrency(
        strategy: ConcurrencyResolutionStrategy,
        values?: EntityDatabaseValues<TEntity>,
    ): Promise<EntityDatabaseValues<TEntity> | null> {
        return state(this).internal.resolveConcurrency(strategy, values);
    }
    public reference<TNavigation>(
        selector: PropertySelector<TEntity, TNavigation>,
    ): ReferenceNavigationEntry<NonNullable<TNavigation>> {
        const current = state(this);
        return createPublicReferenceEntry(
            current.internal,
            selectPropertyName(selector),
            requireLoader(current),
        );
    }
    public collection<TCollection>(
        selector: PropertySelector<TEntity, TCollection>,
    ): CollectionNavigationEntry<CollectionElement<TCollection>> {
        const current = state(this);
        return createPublicCollectionEntry(
            current.internal,
            selectPropertyName(selector),
            requireLoader(current),
        );
    }
    public isNavigationLoaded(navigationProperty: string): boolean {
        return state(this).internal.isNavigationLoaded(navigationProperty);
    }
    public loadedNavigations(): readonly string[] {
        return state(this).internal.loadedNavigations();
    }
}

export function publicEntityEntry<TEntity extends object>(
    internal: InternalEntityEntry<TEntity>,
    loader?: EntityNavigationLoader,
): EntityEntry<TEntity> {
    const existing = publicByInternal.get(internal);
    if (existing) {
        const existingState = stateByPublic.get(existing);
        if (!existingState) {
            throw new Error('EntityKit lost the state for a public EntityEntry.');
        }
        if (loader) existingState.loader = loader;
        return existing as EntityEntry<TEntity>;
    }
    const facade: PublicEntityEntry<TEntity> = new PublicEntityEntry();
    stateByPublic.set(facade, { internal, loader });
    publicByInternal.set(internal, facade);
    return Object.freeze(facade);
}

export function internalEntityEntry<TEntity extends object>(
    entry: EntityEntry<TEntity>,
): InternalEntityEntry<TEntity> {
    const current = stateByPublic.get(entry);
    if (!current) {
        throw new TypeError('EntityEntry was not created by EntityKit.');
    }
    return current.internal as InternalEntityEntry<TEntity>;
}

function state<TEntity extends object>(
    facade: PublicEntityEntry<TEntity>,
): PublicEntryState<TEntity> {
    const current = stateByPublic.get(facade);
    if (!current) {
        throw new TypeError('EntityEntry was not created by EntityKit.');
    }
    return current as PublicEntryState<TEntity>;
}

function requireLoader<TEntity extends object>(
    state: PublicEntryState<TEntity>,
): EntityNavigationLoader {
    if (!state.loader) {
        throw new Error('EntityEntry is not associated with a DbContext navigation loader.');
    }
    return state.loader;
}

type CollectionElement<TCollection> = NonNullable<TCollection> extends
ReadonlyArray<infer TElement> ? NonNullable<TElement> : never;
