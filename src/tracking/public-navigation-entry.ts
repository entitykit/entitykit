import type {
    CollectionNavigationEntry,
    ReferenceNavigationEntry,
} from './navigation-entry-types';
import type {
    EntityNavigationLoader,
} from './navigation-entry';
import type { EntityEntry } from './entity-entry';

export function createPublicReferenceEntry<
    TEntity extends object,
    TNavigation,
>(
    entry: EntityEntry<TEntity>,
    navigationProperty: string,
    loader: EntityNavigationLoader,
): ReferenceNavigationEntry<TNavigation> {
    return Object.freeze({
        navigationProperty,
        get isLoaded(): boolean {
            return entry.isNavigationLoaded(navigationProperty);
        },
        async load(): Promise<TNavigation | null> {
            return loader.loadNavigation(
                entry,
                navigationProperty,
            ) as Promise<TNavigation | null>;
        },
    });
}

export function createPublicCollectionEntry<
    TEntity extends object,
    TElement,
>(
    entry: EntityEntry<TEntity>,
    navigationProperty: string,
    loader: EntityNavigationLoader,
): CollectionNavigationEntry<TElement> {
    return Object.freeze({
        navigationProperty,
        get isLoaded(): boolean {
            return entry.isNavigationLoaded(navigationProperty);
        },
        async load(): Promise<TElement[]> {
            return loader.loadNavigation(
                entry,
                navigationProperty,
            ) as Promise<TElement[]>;
        },
    });
}
