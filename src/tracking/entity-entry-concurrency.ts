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
        this.assertExistingEntry('getDatabaseValues()');
        const values = await this.store.loadDatabaseValues(this.entry);
        return values
            ? createEntityDatabaseValues(this.entry, values)
            : null;
    }

    public async reload(): Promise<boolean> {
        this.assertExistingEntry('reload()');
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
        this.assertConflictState();
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
        const values = readEntityDatabaseValues(this.entry, databaseValues);
        const previousValues = this.entry.currentValues();
        applyMaterializedValues(this.entry.metadata, this.entry.entity, values);
        this.store.fixupReloadedRelationships(this.entry, previousValues);
        this.entry.acceptChanges();
    }

    private applyClientWins(
        databaseValues: EntityDatabaseValues<TEntity>,
    ): void {
        const state = this.entry.state;
        const values = readEntityDatabaseValues(this.entry, databaseValues);
        this.entry.refreshOriginalValues(values);
        syncDatabaseVersions(
            this.entry.metadata,
            this.entry.entity,
            values,
        );
        if (state === EntityState.Deleted) {
            this.entry.state = EntityState.Deleted;
        } else {
            this.entry.detectChanges();
        }
    }

    private assertExistingEntry(operation: string): void {
        if (this.entry.state === EntityState.Detached) {
            throw new Error(
                `${operation} requires a tracked '${this.entry.metadata.entityName}' entry.`,
            );
        }
        if (this.entry.state === EntityState.Added) {
            throw new Error(
                `${operation} is not available for an Added '${this.entry.metadata.entityName}' entry because it has no persisted baseline.`,
            );
        }
    }

    private assertConflictState(): void {
        this.assertExistingEntry('resolveConcurrency()');
        if (
            this.entry.state !== EntityState.Modified &&
            this.entry.state !== EntityState.Deleted
        ) {
            throw new Error(
                `resolveConcurrency() requires a Modified or Deleted '${this.entry.metadata.entityName}' entry, but its state is ${this.entry.state}.`,
            );
        }
    }
}
