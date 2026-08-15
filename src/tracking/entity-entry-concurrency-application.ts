import { applyMaterializedValues } from '../materialization/complex-value-materializer';
import { captureCurrentNavigationSnapshotValues } from './navigation-snapshot';
import { captureReloadRelationshipBoundValues } from './reloaded-relationship-fixup';
import type { EntityDatabaseValues } from './entity-database-values';
import { readEntityDatabaseValues } from './entity-database-values';
import type { EntityEntry } from './entity-entry';
import type { EntityEntryStore } from './entity-entry-store';
import { runFailureAtomicConcurrencyOperation } from './entity-entry-concurrency-operation';
import { syncDatabaseVersions } from './entity-entry-version-sync';

export function applyDatabaseWins<TEntity extends object>(
    entry: EntityEntry<TEntity>,
    store: EntityEntryStore,
    databaseValues: EntityDatabaseValues<TEntity>,
): void {
    const loaded = readEntityDatabaseValues(entry, databaseValues);
    store.assertPersistedIdentity(entry, loaded);
    const previousBoundValues = captureReloadRelationshipBoundValues(entry);
    runFailureAtomicConcurrencyOperation(store, restoration => {
        applyMaterializedValues(
            entry.metadata, entry.entity, loaded.values, restoration,
        );
        store.fixupReloadedRelationships(
            entry, previousBoundValues, loaded.boundValues,
        );
        entry.acceptPersistedValues(
            loaded.values,
            loaded.boundValues,
            captureCurrentNavigationSnapshotValues(
                entry as unknown as EntityEntry<object>,
            ),
        );
    });
}

export function applyClientWins<TEntity extends object>(
    entry: EntityEntry<TEntity>,
    store: EntityEntryStore,
    databaseValues: EntityDatabaseValues<TEntity>,
): void {
    const loaded = readEntityDatabaseValues(entry, databaseValues);
    store.assertPersistedIdentity(entry, loaded);
    runFailureAtomicConcurrencyOperation(store, restoration => {
        entry.refreshPersistedValues(loaded.values, loaded.boundValues);
        syncDatabaseVersions(
            entry.metadata, entry.entity, loaded.values, restoration,
        );
        entry.detectChanges();
    });
}
