import type { EntityEntry } from './entity-entry';

/** Context-owned database operations available to a tracked entry. */
export interface EntityEntryStore {
    loadDatabaseValues<TEntity extends object>(
        entry: EntityEntry<TEntity>,
    ): Promise<Record<string, unknown> | null>;
    fixupReloadedRelationships<TEntity extends object>(
        entry: EntityEntry<TEntity>,
        previousValues: Readonly<Record<string, unknown>>,
    ): void;
    detach<TEntity extends object>(entry: EntityEntry<TEntity>): void;
}
