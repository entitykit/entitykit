import type { EntityEntry } from './entity-entry-types';

/** Application-facing view of the context identity map and change detector. */
export interface ChangeTracker {
    /** Return this object's tracking entry, or undefined. Executes no SQL. */ entry<TEntity extends object>(entity: TEntity): EntityEntry<TEntity> | undefined;
    /** Return the current tracking entries. Executes no SQL. */ entries(): ReadonlyArray<EntityEntry<object>>;
    /** Detach one object and return its former entry, or undefined. Does not write SQL or revert values. */ detach<TEntity extends object>(entity: TEntity): EntityEntry<TEntity> | undefined;
    /** Compare current mapped values with snapshots and update tracked states. Executes no SQL. */ detectChanges(): void;
    /** Accept current baselines and detach Deleted entries without SQL. Rejects Added entries; save or detach them first. */ acceptAllChanges(): void;
    /** Detach all entries without SQL or reverting values. Use DbContext.clearTracking() to discard all pending work. */ clear(): void;
    /** Render tracked states and property changes without executing SQL. */ debugView(): string;
}
