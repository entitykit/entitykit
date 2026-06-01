/** Explicit-loading handle for a reference navigation. */
export interface ReferenceNavigationEntry<TNavigation> {
    /** The navigation property. */ readonly navigationProperty: string;
    /** Whether loaded. */ readonly isLoaded: boolean;
    /** Perform the load operation. */ load(): Promise<TNavigation | null>;
}

/** Explicit-loading handle for a collection navigation. */
export interface CollectionNavigationEntry<TElement> {
    /** The navigation property. */ readonly navigationProperty: string;
    /** Whether loaded. */ readonly isLoaded: boolean;
    /** Perform the load operation. */ load(): Promise<TElement[]>;
}
