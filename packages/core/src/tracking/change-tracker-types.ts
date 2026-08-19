import type { EntityEntry } from './entity-entry-types';

/** Application-facing view of the context identity map and change detector. */
export interface ChangeTracker {
    /** Perform the entry operation. */ entry<TEntity extends object>(entity: TEntity): EntityEntry<TEntity> | undefined;
    /** Perform the entries operation. */ entries(): ReadonlyArray<EntityEntry<object>>;
    /** Perform the detach operation. */ detach<TEntity extends object>(entity: TEntity): EntityEntry<TEntity> | undefined;
    /** Perform the detect changes operation. */ detectChanges(): void;
    /** Perform the accept all changes operation. */ acceptAllChanges(): void;
    /** Perform the clear operation. */ clear(): void;
    /** Perform the debug view operation. */ debugView(): string;
}
