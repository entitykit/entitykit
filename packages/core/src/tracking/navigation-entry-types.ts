/** Explicit-loading handle for a reference navigation. */
export interface ReferenceNavigationEntry<TNavigation> {
    /** Mapped navigation property name. */ readonly navigationProperty: string;
    /** Whether EntityKit has deliberately loaded this navigation, including empty results. */ readonly isLoaded: boolean;
    /** Load and return related entities, performing SQL when needed. Requires a persisted owner still tracked by this context. */ load(): Promise<TNavigation | null>;
}

/** Explicit-loading handle for a collection navigation. */
export interface CollectionNavigationEntry<TElement> {
    /** Mapped navigation property name. */ readonly navigationProperty: string;
    /** Whether EntityKit has deliberately loaded this navigation, including empty results. */ readonly isLoaded: boolean;
    /** Load and return related entities, performing SQL when needed. Requires a persisted owner still tracked by this context. */ load(): Promise<TElement[]>;
}
