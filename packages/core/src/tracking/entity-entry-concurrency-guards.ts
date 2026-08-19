import type { EntityEntry } from './entity-entry';
import { EntityState } from './entity-state';

export function assertConcurrencyExistingEntry<TEntity extends object>(
    entry: EntityEntry<TEntity>,
    operation: string,
): void {
    if (entry.state === EntityState.Detached) {
        throw new Error(
            `${operation} requires a tracked '${entry.metadata.entityName}' entry.`,
        );
    }
    if (entry.state === EntityState.Added) {
        throw new Error(
            `${operation} is not available for an Added ` +
            `'${entry.metadata.entityName}' entry because it has no persisted baseline.`,
        );
    }
}

export function assertConcurrencyConflictState<TEntity extends object>(
    entry: EntityEntry<TEntity>,
): void {
    assertConcurrencyExistingEntry(entry, 'resolveConcurrency()');
    if (
        entry.state !== EntityState.Modified &&
        entry.state !== EntityState.Deleted
    ) {
        throw new Error(
            'resolveConcurrency() requires a Modified or Deleted ' +
            `'${entry.metadata.entityName}' entry, but its state is ${entry.state}.`,
        );
    }
}
