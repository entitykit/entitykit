import type { EntityEntry } from './entity-entry';
import {
    captureNavigation,
    forgetNavigation,
} from './navigation-snapshot';

export class EntityEntryNavigationState {
    private readonly loaded: Set<string> = new Set();

    public markLoaded(entry: EntityEntry<object>, property: string): void {
        this.loaded.add(property);
        captureNavigation(entry, property);
    }

    public markNotLoaded(entry: EntityEntry<object>, property: string): void {
        this.loaded.delete(property);
        forgetNavigation(entry, property);
    }

    public isLoaded(property: string): boolean {
        return this.loaded.has(property);
    }

    public properties(): readonly string[] {
        return Array.from(this.loaded).sort();
    }
}
