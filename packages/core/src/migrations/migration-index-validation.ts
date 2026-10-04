import type { Migration } from './migration';
import { validateIndexDatabaseNames } from '../model/index-name-validation';

/** Validate both directions against the executing provider before acquiring resources or emitting SQL. */
export function validateMigrationIndexNames(migration: Migration, providerName?: string): void {
    for (const snapshot of [migration.previousSnapshot, migration.targetSnapshot]) {
        for (const entity of snapshot?.entities ?? []) validateIndexDatabaseNames(entity, providerName);
    }
}
