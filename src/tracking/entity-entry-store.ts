import type { EntityEntry } from './entity-entry';

export interface LoadedEntityDatabaseValues {
    readonly values: Record<string, unknown>;
    readonly boundValues: Record<string, unknown>;
}

export interface EntityEntryRestorationCheckpoint {
    rollback(): void;
}

/** Context-owned database operations available to a tracked entry. */
export interface EntityEntryStore {
    assertUsable(operation: string): void;
    markRestorationFailure(cause: unknown): void;
    captureRestoration(): EntityEntryRestorationCheckpoint;
    loadDatabaseValues<TEntity extends object>(
        entry: EntityEntry<TEntity>,
    ): Promise<LoadedEntityDatabaseValues | null>;
    fixupReloadedRelationships<TEntity extends object>(
        entry: EntityEntry<TEntity>,
        previousBoundValues: Readonly<Record<string, unknown>>,
        reloadedBoundValues: Readonly<Record<string, unknown>>,
    ): void;
    assertPersistedIdentity<TEntity extends object>(
        entry: EntityEntry<TEntity>,
        values: LoadedEntityDatabaseValues,
    ): void;
    detach<TEntity extends object>(entry: EntityEntry<TEntity>): void;
}
