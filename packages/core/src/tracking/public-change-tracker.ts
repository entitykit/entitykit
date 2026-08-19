import type { EntityNavigationLoader } from './navigation-entry';
import type { ChangeTracker as InternalChangeTracker } from './change-tracker';
import type { ChangeTracker } from './change-tracker-types';
import type { EntityEntry } from './entity-entry-types';
import { publicEntityEntry } from './public-entity-entry';
import { EntityState } from './entity-state';

interface PublicTrackerState {
    readonly internal: InternalChangeTracker;
    readonly loader: EntityNavigationLoader;
}

const publicByInternal: WeakMap<InternalChangeTracker, ChangeTracker> =
    new WeakMap();
const stateByPublic: WeakMap<object, PublicTrackerState> = new WeakMap();

class PublicChangeTracker implements ChangeTracker {
    public entry<TEntity extends object>(
        entity: TEntity,
    ): EntityEntry<TEntity> | undefined {
        const current = state(this);
        const entry = current.internal.entry(entity);
        return entry ? publicEntityEntry(entry, current.loader) : undefined;
    }
    public entries(): ReadonlyArray<EntityEntry<object>> {
        const current = state(this);
        return current.internal.entries().map(entry =>
            publicEntityEntry(entry, current.loader));
    }
    public detach<TEntity extends object>(
        entity: TEntity,
    ): EntityEntry<TEntity> | undefined {
        const current = state(this);
        const entry = current.internal.detach(entity);
        return entry ? publicEntityEntry(entry, current.loader) : undefined;
    }
    public detectChanges(): void {
        state(this).internal.detectChanges();
    }
    public acceptAllChanges(): void {
        const tracker = state(this).internal;
        if (tracker.entries().some(entry => entry.state === EntityState.Added)) {
            throw new Error(
                'acceptAllChanges() cannot accept Added entries because they have no persisted baseline. Save or detach them first.',
            );
        }
        tracker.acceptAllChanges();
    }
    public clear(): void {
        state(this).internal.clear();
    }
    public debugView(): string {
        return state(this).internal.debugView();
    }
}

export function publicChangeTracker(
    internal: InternalChangeTracker,
    loader: EntityNavigationLoader,
): ChangeTracker {
    const existing = publicByInternal.get(internal);
    if (existing) return existing;
    const facade = new PublicChangeTracker();
    stateByPublic.set(facade, { internal, loader });
    publicByInternal.set(internal, facade);
    return Object.freeze(facade);
}

export function internalChangeTracker(
    tracker: ChangeTracker,
): InternalChangeTracker {
    const current = stateByPublic.get(tracker);
    if (!current) {
        throw new TypeError('ChangeTracker was not created by EntityKit.');
    }
    return current.internal;
}

function state(facade: PublicChangeTracker): PublicTrackerState {
    const current = stateByPublic.get(facade);
    if (!current) {
        throw new TypeError('ChangeTracker was not created by EntityKit.');
    }
    return current;
}
