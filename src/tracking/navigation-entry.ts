import type { PropertySelector } from '../model/model-property-selector';
import { selectPropertyName } from '../model/model-property-selector';
import type { EntityEntry } from './entity-entry';

export interface EntityNavigationLoader {
    loadNavigation<TEntity extends object>(entry: EntityEntry<TEntity>, navigationProperty: string): Promise<unknown>;
}

export class ReferenceNavigationEntry<TEntity extends object, TNavigation> {
    constructor(
        private readonly entry: EntityEntry<TEntity>,
        public readonly navigationProperty: string,
        private readonly loader: EntityNavigationLoader,
    ) {}

    public get isLoaded(): boolean {
        return this.entry.isNavigationLoaded(this.navigationProperty);
    }

    public async load(): Promise<TNavigation | null> {
        return this.loader.loadNavigation(this.entry, this.navigationProperty) as Promise<TNavigation | null>;
    }
}

export class CollectionNavigationEntry<TEntity extends object, TElement> {
    constructor(
        private readonly entry: EntityEntry<TEntity>,
        public readonly navigationProperty: string,
        private readonly loader: EntityNavigationLoader,
    ) {}

    public get isLoaded(): boolean {
        return this.entry.isNavigationLoaded(this.navigationProperty);
    }

    public async load(): Promise<TElement[]> {
        return this.loader.loadNavigation(this.entry, this.navigationProperty) as Promise<TElement[]>;
    }
}

export function referenceEntry<TEntity extends object, TNavigation>(
    entry: EntityEntry<TEntity>,
    selector: PropertySelector<TEntity, TNavigation>,
    loader: EntityNavigationLoader,
): ReferenceNavigationEntry<TEntity, NonNullable<TNavigation>> {
    return new ReferenceNavigationEntry(entry, selectPropertyName(selector), loader);
}

export function collectionEntry<TEntity extends object, TCollection>(
    entry: EntityEntry<TEntity>,
    selector: PropertySelector<TEntity, TCollection>,
    loader: EntityNavigationLoader,
): CollectionNavigationEntry<TEntity, CollectionElement<TCollection>> {
    return new CollectionNavigationEntry(entry, selectPropertyName(selector), loader);
}

type CollectionElement<TCollection> = NonNullable<TCollection> extends ReadonlyArray<infer TElement>
    ? NonNullable<TElement>
    : never;
