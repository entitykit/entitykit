import type { EntityEntry } from './entity-entry';
import { captureNavigation } from './navigation-snapshot';
import { loadedReferenceKey } from './loaded-reference-state';
import {
    allowNavigationChangeDetection,
    suppressNavigationChangeDetection,
} from './navigation-change-detection-state';

export class EntityEntryNavigationState {
    private readonly loaded: Map<string, string | null> = new Map();

    public markLoaded(
        entry: EntityEntry<object>,
        property: string,
        boundValues?: Readonly<Record<string, unknown>>,
    ): void {
        allowNavigationChangeDetection(entry, property);
        this.loaded.set(
            property, loadedReferenceKey(entry, property, boundValues),
        );
        captureNavigation(entry, property);
    }

    public markNotLoaded(entry: EntityEntry<object>, property: string): void {
        this.loaded.delete(property);
        suppressNavigationChangeDetection(entry, property);
    }

    public isLoaded(entry: EntityEntry<object>, property: string): boolean {
        if (!this.loaded.has(property)) return false;
        const loadedKey = this.loaded.get(property);
        if (loadedKey === null || loadedKey === loadedReferenceKey(entry, property)) {
            return true;
        }
        this.loaded.delete(property);
        return false;
    }

    public properties(entry: EntityEntry<object>): readonly string[] {
        return [...this.loaded.keys()]
            .filter(property => this.isLoaded(entry, property))
            .sort();
    }
}
