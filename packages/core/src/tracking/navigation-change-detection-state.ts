import type { EntityEntry } from './entity-entry';

const suppressed: WeakMap<EntityEntry<object>, Set<string>> = new WeakMap();

export function captureNavigationChangeDetectionState(
    entry: EntityEntry<object>,
): ReadonlySet<string> {
    return new Set(suppressed.get(entry));
}

export function restoreNavigationChangeDetectionState(
    entry: EntityEntry<object>,
    properties: ReadonlySet<string>,
): void {
    if (properties.size === 0) {
        suppressed.delete(entry);
        return;
    }
    suppressed.set(entry, new Set(properties));
}

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
