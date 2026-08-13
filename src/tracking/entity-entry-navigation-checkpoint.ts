import type { EntityEntry } from './entity-entry';

interface NavigationCheckpointState {
    capture(): ReadonlyMap<string, string | null>;
    restore(values: ReadonlyMap<string, string | null>): void;
}

const states: WeakMap<
    EntityEntry<object>, NavigationCheckpointState
> = new WeakMap();

export function registerEntryNavigationCheckpoint(
    entry: EntityEntry<object>,
    state: NavigationCheckpointState,
): void {
    states.set(entry, state);
}

export function captureEntryLoadedNavigations(
    entry: EntityEntry<object>,
): ReadonlyMap<string, string | null> {
    return requireState(entry).capture();
}

export function restoreEntryLoadedNavigations(
    entry: EntityEntry<object>,
    values: ReadonlyMap<string, string | null>,
): void {
    requireState(entry).restore(values);
}

function requireState(entry: EntityEntry<object>): NavigationCheckpointState {
    const state = states.get(entry);
    if (!state) throw new Error('Entity navigation state is unavailable.');
    return state;
}
