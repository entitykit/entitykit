/**
 * Pure, connection-free guards the migration runner performs before it
 * executes a migration range. They answer two questions that must be settled
 * before any DDL runs: is the database's applied-migration history internally
 * consistent and does it match the local project, and does the pending range
 * contain destructive schema changes that require an explicit opt-in?
 */
import type { Migration } from '../migration';
import type { MigrationHistoryRow } from '../migration-history';
import { collectDestructiveWarnings } from '../migration-scaffolder';
import { diffModelSnapshots } from '../model-differ';
import { MigrationChecksumError, MigrationError } from '../../errors/migration-errors';

export function migrationIdFromError(error: unknown): string | undefined {
    if (!error || typeof error !== 'object') {
        return undefined;
    }

    const details = (error as { readonly details?: unknown }).details;
    if (!details || typeof details !== 'object') {
        return undefined;
    }

    const migrationId = (details as { readonly migrationId?: unknown }).migrationId;
    return typeof migrationId === 'string' ? migrationId : undefined;
}

export function validateAppliedChecksums(
    migrations: readonly Migration[],
    applied: readonly MigrationHistoryRow[],
    checksum: (migration: Migration) => string,
): void {
    validateAppliedHistoryShape(applied);

    const migrationsById = new Map(migrations.map(migration => [migration.id, migration]));
    for (const row of applied) {
        const migration = migrationsById.get(row.id);
        if (!migration) {
            throw new MigrationError(
                `Applied migration '${row.id}' exists in the database but was not found in local migrations. Restore the missing migration file or target a database whose history matches this project.`,
                { details: {
                    migrationId: row.id,
                    driftKind: 'missingLocalMigration',
                    nextAction: 'Restore the missing migration file or target a database whose history matches this project.',
                } },
            );
        }

        const expectedChecksum = checksum(migration);
        if (row.checksum && row.checksum !== expectedChecksum) {
            throw new MigrationChecksumError(row.id);
        }
    }
}

function validateAppliedHistoryShape(applied: readonly MigrationHistoryRow[]): void {
    const seen: Set<string> = new Set();
    let previousId: string | undefined;

    for (const row of applied) {
        if (seen.has(row.id)) {
            throw new MigrationError(
                `Applied migration '${row.id}' appears more than once in migration history. Run db status, verify the database schema state, then remove the duplicate history row or restore migration history from a clean backup before updating.`,
                { details: {
                    migrationId: row.id,
                    driftKind: 'duplicateAppliedMigration',
                    nextAction: 'Run db status, verify the database schema state, then remove the duplicate history row or restore migration history from a clean backup before updating.',
                } },
            );
        }

        if (previousId && previousId.localeCompare(row.id) > 0) {
            throw new MigrationError(
                `Applied migration history is not ordered by id: '${row.id}' appeared after '${previousId}'. Run db status and verify the provider migration history query before updating.`,
                { details: {
                    migrationId: row.id,
                    previousMigrationId: previousId,
                    driftKind: 'outOfOrderAppliedHistory',
                    nextAction: 'Run db status and verify the provider migration history query before updating.',
                } },
            );
        }

        seen.add(row.id);
        previousId = row.id;
    }
}

export function destructiveWarningsForMigration(migration: Migration): readonly string[] {
    if (!migration.previousSnapshot || !migration.targetSnapshot) {
        return [];
    }

    return collectDestructiveWarnings(diffModelSnapshots(migration.previousSnapshot, migration.targetSnapshot).operations);
}
