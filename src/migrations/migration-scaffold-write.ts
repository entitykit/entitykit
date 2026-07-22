/**
 * Persisting a computed scaffold to disk as an all-or-nothing pair.
 *
 * Writes the migration file and its snapshot sidecar together: if the snapshot
 * write fails after the migration was written, the migration is removed so the
 * two never land out of sync. Refuses to overwrite an existing migration file.
 */
import fs from 'fs';
import { writeFilesAtomically } from '../tooling/atomic-file-writer';
import type { MigrationScaffoldResult } from './migration-scaffold-types';

/** Perform the write migration scaffold operation. */ export function writeMigrationScaffold(scaffold: MigrationScaffoldResult): void {
    if (fs.existsSync(scaffold.migrationPath)) {
        throw new Error(`Migration file already exists: ${scaffold.migrationPath}`);
    }

    try {
        writeFilesAtomically([
            { path: scaffold.migrationPath, contents: scaffold.migrationSource },
            { path: scaffold.snapshotPath, contents: scaffold.snapshotSource, replace: true },
        ]);
    } catch (error) {
        throw new Error(
            `Failed to write migration scaffold. Existing files were restored: ${errorMessage(error)}`,
            { cause: error },
        );
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
