import type {
    ConcurrencyResolutionStrategy,
} from './entity-entry-concurrency-types';
import {
    createEntityDatabaseValues,
    type EntityDatabaseValues,
} from './entity-database-values';
import type { EntityEntry } from './entity-entry';
import type { EntityEntryStore } from './entity-entry-store';
import {
    assertConcurrencyConflictState,
    assertConcurrencyExistingEntry,
} from './entity-entry-concurrency-guards';
import {
    applyClientWins,
    applyDatabaseWins,
} from './entity-entry-concurrency-application';
import {
    runFailureAtomicConcurrencyOperation,
} from './entity-entry-concurrency-operation';

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
        this.store.assertUsable('getDatabaseValues()');
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
        this.store.assertUsable('reload()');
        assertConcurrencyExistingEntry(this.entry, 'reload()');
        const databaseValues = await this.getDatabaseValues();
        if (!databaseValues) {
            runFailureAtomicConcurrencyOperation(this.store, () => {
                this.store.detach(this.entry);
            });
            return false;
        }
        applyDatabaseWins(this.entry, this.store, databaseValues);
        return true;
    }

    public async resolve(
        strategy: ConcurrencyResolutionStrategy,
        provided?: EntityDatabaseValues<TEntity>,
    ): Promise<EntityDatabaseValues<TEntity> | null> {
        this.store.assertUsable('resolveConcurrency()');
        assertConcurrencyConflictState(this.entry);
        const databaseValues = provided ?? await this.getDatabaseValues();
        if (!databaseValues) {
            if (strategy === 'databaseWins') {
                runFailureAtomicConcurrencyOperation(this.store, () => {
                    this.store.detach(this.entry);
                });
                return null;
            }
            throw new Error(
                `Cannot resolve '${this.entry.metadata.entityName}' with clientWins because the database row no longer exists.`,
            );
        }

        if (strategy === 'databaseWins') {
            applyDatabaseWins(this.entry, this.store, databaseValues);
        } else {
            applyClientWins(this.entry, this.store, databaseValues);
        }
        return databaseValues;
    }
}
