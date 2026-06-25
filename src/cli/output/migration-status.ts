import type { DiscoveredMigration } from '../../migrations/migration-discovery-types';
import type { MigrationBuilderFactory } from '../../migrations/migration-builder-contract';
import { migrationChecksum, type MigrationHistoryRow } from '../../migrations/migration-history';
import type { MigrationSqlDialect } from '../../migrations/migration-sql-dialect';

/** One actionable mismatch between local and database migration history. */
export interface MigrationStatusDrift {
    readonly kind: 'checksumMismatch' | 'duplicateApplied' | 'missingLocal' | 'outOfOrder';
    readonly migrationId: string;
    readonly migrationName?: string;
    readonly message: string;
}

/** Structured status shared by text, JSON, and `--check`. */
export interface MigrationStatusData {
    readonly local: ReadonlyArray<{ readonly id: string; readonly name: string }>;
    readonly applied: readonly string[];
    readonly pending: readonly string[];
    readonly drift: readonly MigrationStatusDrift[];
    readonly current: string;
    readonly target: string;
    readonly clean: boolean;
}

/** Compare local migration artifacts with migration history. */
export function createMigrationStatus(
    migrations: readonly DiscoveredMigration[],
    appliedMigrations: readonly MigrationHistoryRow[],
    dialect: MigrationSqlDialect,
    createMigrationBuilder: MigrationBuilderFactory,
): MigrationStatusData {
    const local = migrations.map(item => ({ id: item.migration.id, name: item.migration.name }));
    const applied = appliedMigrations.map(row => row.id);
    const appliedIds = new Set(applied);
    const pending = local.filter(item => !appliedIds.has(item.id)).map(item => item.id);
    const drift = collectDrift(migrations, appliedMigrations, dialect, createMigrationBuilder);
    return {
        local,
        applied,
        pending,
        drift,
        current: applied.at(-1) ?? '0',
        target: local.at(-1)?.id ?? '0',
        clean: pending.length === 0 && drift.length === 0,
    };
}

/** Render migration status for a person without losing actionable detail. */
export function renderMigrationStatus(status: MigrationStatusData): string {
    const lines = [
        'Database migration status',
        `Current: ${status.current}`,
        `Target: ${status.target}`,
        `Applied: ${String(status.applied.length)}`,
        `Pending: ${String(status.pending.length)}`,
        `Drift: ${status.drift.length === 0 ? 'none' : `${String(status.drift.length)} issue(s)`}`,
    ];
    if (status.pending.length > 0) {
        lines.push('', 'Pending:', ...status.pending.map(id => `  ${id}`));
    }
    if (status.drift.length > 0) {
        lines.push('', 'Drift:', ...status.drift.flatMap(item => [
            `  ${item.migrationId}: ${item.kind}`,
            `    ${item.message}`,
        ]));
    }
    return lines.join('\n');
}

function collectDrift(
    migrations: readonly DiscoveredMigration[],
    applied: readonly MigrationHistoryRow[],
    dialect: MigrationSqlDialect,
    createMigrationBuilder: MigrationBuilderFactory,
): MigrationStatusDrift[] {
    const localById = new Map(migrations.map(item => [item.migration.id, item.migration]));
    const drift: MigrationStatusDrift[] = [];
    const seen: Set<string> = new Set();
    let previous: string | undefined;
    for (const row of applied) {
        if (seen.has(row.id)) {
            drift.push(item('duplicateApplied', row, 'Remove the duplicate history row after verifying the database schema.'));
        }
        if (previous && previous.localeCompare(row.id) > 0) {
            drift.push(item('outOfOrder', row, 'Verify that the provider returns migration history ordered by id.'));
        }
        seen.add(row.id);
        previous = row.id;
        const local = localById.get(row.id);
        if (!local) {
            drift.push(item('missingLocal', row, 'Restore the exact migration file used by this database.'));
        } else if (row.checksum && row.checksum !== migrationChecksum(local, dialect.sql, createMigrationBuilder)) {
            drift.push(item('checksumMismatch', row, 'Restore the applied migration file or create a corrective migration.'));
        }
    }
    return drift;
}

function item(
    kind: MigrationStatusDrift['kind'],
    row: MigrationHistoryRow,
    message: string,
): MigrationStatusDrift {
    return { kind, migrationId: row.id, migrationName: row.name, message };
}
