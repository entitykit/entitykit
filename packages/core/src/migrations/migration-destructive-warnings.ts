import type { Migration } from './migration';
import { MigrationError } from '../errors/migration-errors';
import { collectDestructiveWarnings } from './migration-scaffold-warnings';
import { diffModelSnapshots } from './model-differ';

/** Use the reviewed operation list without losing explicit rename intent. */
export function destructiveWarningsForMigration(migration: Migration): readonly string[] {
    const reviewed = migration.destructiveWarnings;
    const unchecked: unknown = reviewed;
    if (reviewed !== undefined) {
        if (!Array.isArray(unchecked) || unchecked.some((warning: unknown) => typeof warning !== 'string' || !warning.trim())) {
            throw new MigrationError('Migration destructiveWarnings must contain only non-empty strings.');
        }
        return reviewed;
    }
    if (!migration.previousSnapshot || !migration.targetSnapshot) return [];
    return collectDestructiveWarnings(diffModelSnapshots(migration.previousSnapshot, migration.targetSnapshot).operations);
}
