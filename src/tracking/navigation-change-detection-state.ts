import type { EntityEntry } from './entity-entry';

const suppressed: WeakMap<EntityEntry<object>, Set<string>> = new WeakMap();

export function allowNavigationChangeDetection(
    entry: EntityEntry<object>,
    property: string,
): void {
    suppressed.get(entry)?.delete(property);
}

export function suppressNavigationChangeDetection(
    entry: EntityEntry<object>,
    property: string,
): void {
    const properties = suppressed.get(entry) ?? new Set<string>();
    properties.add(property);
    suppressed.set(entry, properties);
}

export function navigationChangeDetectionAllowed(
    entry: EntityEntry<object>,
    property: string,
): boolean {
    return !suppressed.get(entry)?.has(property);
}
