/**
 * Orchestration for migration scaffolding: diff the current model against the
 * snapshot on disk, then compose the focused modules — snapshot I/O, timestamp
 * and name derivation, destructive-warning collection, and source rendering —
 * into a ready-to-write result. Writing that result to disk lives in
 * MigrationScaffoldWrite.
 *
 * The public migrations surface (re-exported by src/migrations/api.ts and the
 * internal src/migrations/index.ts barrel) is preserved here: functions and
 * types that moved into sibling modules are re-exported by name below.
 */
import path from 'path';
import type { ModelSnapshotSource } from './model-snapshot-source';
import { diffModelSnapshots } from './model-differ';
import { emptySnapshot, readModelSnapshot, renderSnapshotSource } from './migration-scaffold-snapshot';
import { collectDestructiveWarnings } from './migration-scaffold-warnings';
import { nextMigrationTimestamp, toPascalIdentifier } from './migration-scaffold-timestamp';
import { renderMigrationSource } from './migration-scaffold-render';
import type { MigrationScaffoldOptions, MigrationScaffoldResult } from './migration-scaffold-types';
import { addSqliteRebuildOperations } from './model-diff-sqlite-rebuild';

export type { MigrationScaffoldOptions, MigrationScaffoldResult } from './migration-scaffold-types';
export { readModelSnapshot, renderSnapshotSource } from './migration-scaffold-snapshot';
export { collectDestructiveWarnings } from './migration-scaffold-warnings';
export { formatMigrationTimestamp } from './migration-scaffold-timestamp';
export { writeMigrationScaffold } from './migration-scaffold-write';

/** Perform the scaffold migration operation. */ export function scaffoldMigration(
    context: ModelSnapshotSource,
    options: MigrationScaffoldOptions,
): MigrationScaffoldResult {
    const previousSnapshot = readModelSnapshot(options.snapshotPath) ?? emptySnapshot();
    const targetSnapshot = context.createModelSnapshot();
    const diff = diffModelSnapshots(previousSnapshot, targetSnapshot, { renameHints: options.renameHints });

    if (!diff.hasChanges && !options.allowEmpty) {
        throw new Error('No model changes were detected. Use --empty to create an empty migration.');
    }

    const className = toPascalIdentifier(options.name);
    // Timestamps have second resolution, so two `migration add` calls in the
    // same second would produce identical prefixes and leave ordering to the
    // migration *name*. Advancing past the newest existing migration keeps ids
    // monotonic, which is what the runner orders by.
    const timestamp = nextMigrationTimestamp(options.now ?? new Date(), options.migrationsDir);
    const id = `${timestamp}_${className}`;
    const migrationPath = path.join(options.migrationsDir, `${id}.ts`);
    const warnings = collectDestructiveWarnings(diff.operations);
    const migrationOperations = addSqliteRebuildOperations(
        diff.operations,
        previousSnapshot,
        targetSnapshot,
    );
    const migrationSource = renderMigrationSource({
        id,
        className,
        previousSnapshot,
        targetSnapshot,
        operations: migrationOperations,
        warnings,
    });
    const snapshotSource = renderSnapshotSource(targetSnapshot);

    return {
        id,
        className,
        migrationPath,
        snapshotPath: options.snapshotPath,
        migrationSource,
        snapshotSource,
        operations: diff.operations,
        warnings,
        hasChanges: diff.hasChanges,
    };
}
