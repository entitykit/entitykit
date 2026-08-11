import type {
    ConcurrencyResolutionStrategy,
} from './entity-entry-concurrency-types';
import {
    createEntityDatabaseValues,
    type EntityDatabaseValues,
    readEntityDatabaseValues,
} from './entity-database-values';
import type { EntityEntry } from './entity-entry';
import type { EntityEntryStore } from './entity-entry-store';
import { EntityState } from './entity-state';
import { applyMaterializedValues } from '../materialization/complex-value-materializer';
import { syncDatabaseVersions } from './entity-entry-version-sync';
import { captureCurrentNavigationSnapshotValues } from './navigation-snapshot';
import {
    assertConcurrencyConflictState,
    assertConcurrencyExistingEntry,
} from './entity-entry-concurrency-guards';
import { captureReloadRelationshipBoundValues } from './reloaded-relationship-fixup';

const concurrencyByEntry: WeakMap<object, object> = new WeakMap();

export function configureEntityEntryStore<TEntity extends object>(
    entry: EntityEntry<TEntity>,
    store: EntityEntryStore,
): void {
    concurrencyByEntry.set(entry, new EntityEntryConcurrency(entry, store));
}

export function entityEntryConcurrency<TEntity extends object>(
    entry: EntityEntry<TEntity>,
): EntityEntryConcurrency<TEntity> {
    const concurrency = concurrencyByEntry.get(entry);
    if (!concurrency) {
        throw new Error(
            `EntityEntry for '${entry.metadata.entityName}' is not associated with a DbContext store.`,
        );
    }
    return concurrency as EntityEntryConcurrency<TEntity>;
}

export class EntityEntryConcurrency<TEntity extends object> {
    constructor(
        private readonly entry: EntityEntry<TEntity>,
        private readonly store: EntityEntryStore,
    ) {}

    public async getDatabaseValues(): Promise<
        EntityDatabaseValues<TEntity> | null
    > {
        assertConcurrencyExistingEntry(this.entry, 'getDatabaseValues()');
        const loaded = await this.store.loadDatabaseValues(this.entry);
        if (loaded) {
            this.store.assertPersistedIdentity(this.entry, loaded);
        }
        return loaded
            ? createEntityDatabaseValues(
                this.entry,
                loaded.values,
                loaded.boundValues,
            )
            : null;
    }

    public async reload(): Promise<boolean> {
        assertConcurrencyExistingEntry(this.entry, 'reload()');
        const databaseValues = await this.getDatabaseValues();
        if (!databaseValues) {
            this.store.detach(this.entry);
            return false;
        }
        this.applyDatabaseWins(databaseValues);
        return true;
    }

    public async resolve(
        strategy: ConcurrencyResolutionStrategy,
        provided?: EntityDatabaseValues<TEntity>,
    ): Promise<EntityDatabaseValues<TEntity> | null> {
        assertConcurrencyConflictState(this.entry);
        const databaseValues = provided ?? await this.getDatabaseValues();
        if (!databaseValues) {
            if (strategy === 'databaseWins') {
                this.store.detach(this.entry);
                return null;
            }
            throw new Error(
                `Cannot resolve '${this.entry.metadata.entityName}' with clientWins because the database row no longer exists.`,
            );
        }

        if (strategy === 'databaseWins') {
            this.applyDatabaseWins(databaseValues);
        } else {
            this.applyClientWins(databaseValues);
        }
        return databaseValues;
    }

    private applyDatabaseWins(
        databaseValues: EntityDatabaseValues<TEntity>,
    ): void {
        const loaded = readEntityDatabaseValues(this.entry, databaseValues);
        this.store.assertPersistedIdentity(this.entry, loaded);
        const previousBoundValues = captureReloadRelationshipBoundValues(
            this.entry,
        );
        applyMaterializedValues(
            this.entry.metadata,
            this.entry.entity,
            loaded.values,
        );
        this.store.fixupReloadedRelationships(
            this.entry,
            previousBoundValues,
            loaded.boundValues,
        );
        this.entry.acceptPersistedValues(
            loaded.values,
            loaded.boundValues,
            captureCurrentNavigationSnapshotValues(
                this.entry as unknown as EntityEntry<object>,
            ),
        );
    }

    private applyClientWins(
        databaseValues: EntityDatabaseValues<TEntity>,
    ): void {
        const state = this.entry.state;
        const loaded = readEntityDatabaseValues(this.entry, databaseValues);
        this.store.assertPersistedIdentity(this.entry, loaded);
        this.entry.refreshPersistedValues(
            loaded.values,
            loaded.boundValues,
        );
        syncDatabaseVersions(
            this.entry.metadata,
            this.entry.entity,
            loaded.values,
        );
        if (state === EntityState.Deleted) {
            this.entry.transitionToState(EntityState.Deleted);
        } else {
            this.entry.detectChanges();
        }
    }
}
