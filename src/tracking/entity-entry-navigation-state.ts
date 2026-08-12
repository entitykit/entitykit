import type { EntityEntry } from './entity-entry';
import {
    captureNavigation,
    forgetNavigation,
} from './navigation-snapshot';
import { loadedReferenceKey } from './loaded-reference-state';

export class EntityEntryNavigationState {
    private readonly loaded: Map<string, string | null> = new Map();

    public markLoaded(
        entry: EntityEntry<object>,
        property: string,
        boundValues?: Readonly<Record<string, unknown>>,
    ): void {
        this.loaded.set(
            property, loadedReferenceKey(entry, property, boundValues),
        );
        captureNavigation(entry, property);
    }

    public markNotLoaded(entry: EntityEntry<object>, property: string): void {
        this.loaded.delete(property);
        forgetNavigation(entry, property);
    }

    public isLoaded(entry: EntityEntry<object>, property: string): boolean {
        if (!this.loaded.has(property)) return false;
        const loadedKey = this.loaded.get(property);
        if (loadedKey === null || loadedKey === loadedReferenceKey(entry, property)) {
            return true;
        }
        this.markNotLoaded(entry, property);
        return false;
    }

    public properties(entry: EntityEntry<object>): readonly string[] {
        return [...this.loaded.keys()]
            .filter(property => this.isLoaded(entry, property))
            .sort();
    }
}
