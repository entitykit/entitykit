import fs from 'fs';
import { changeFilesAtomically, type AtomicFileChange } from '../tooling/atomic-file-writer';
import type { ModelSnapshotSource } from './model-snapshot-source';
import { collectDestructiveWarnings, scaffoldMigration, writeMigrationScaffold } from './migration-scaffolder';
import { discoverMigrations } from './migration-directory-discovery';
import type { DiscoveredMigration } from './migration-discovery-types';
import { diffModelSnapshots, type ModelDiffRenameHints } from './model-differ';
import { renderSnapshotSource } from './migration-scaffolder';
import type { ModelSnapshot } from '../model/model-snapshot-types';
import { MigrationDataLossError, MigrationError } from '../errors/migration-errors';

/** Result produced by migration add. */ export interface MigrationAddResult {
    /** The id. */ readonly id: string;
    /** The migration path. */ readonly migrationPath: string;
    /** The snapshot path. */ readonly snapshotPath: string;
    /** The operations. */ readonly operations: number;
    /** The warnings. */ readonly warnings: readonly string[];
}

/** Result produced by migration remove. */ export interface MigrationRemoveResult {
    /** The removed migration id. */ readonly removedMigrationId: string;
    /** The removed migration path. */ readonly removedMigrationPath: string;
    /** The restored snapshot. */ readonly restoredSnapshot: boolean;
}

/** Result produced by pending model changes. */ export interface PendingModelChangesResult {
    /** Whether pending changes. */ readonly hasPendingChanges: boolean;
    /** The operations. */ readonly operations: number;
    /** The warnings. */ readonly warnings: readonly string[];
}

/** Perform the add migration operation. */ export function addMigration(
    context: ModelSnapshotSource,
    options: {
        readonly name: string;
        readonly migrationsDir: string;
        /** The snapshot path. */ readonly snapshotPath: string;
        readonly now?: Date;
        readonly allowEmpty?: boolean;
        readonly allowDataLoss?: boolean;
        readonly renameHints?: ModelDiffRenameHints;
    },
): MigrationAddResult {
    const scaffold = scaffoldMigration(context, options);
    if (scaffold.warnings.length > 0 && !options.allowDataLoss) {
        throw new MigrationDataLossError(scaffold.warnings);
    }
    writeMigrationScaffold(scaffold);
    return {
        id: scaffold.id,
        migrationPath: scaffold.migrationPath,
        snapshotPath: scaffold.snapshotPath,
        operations: scaffold.operations.length,
        warnings: scaffold.warnings,
    };
}

/** Perform the remove latest migration operation. */ export async function removeLatestMigration(options: {
    readonly migrationsDir: string;
    /** The snapshot path. */ readonly snapshotPath: string;
    readonly appliedMigrationIds?: readonly string[];
}): Promise<MigrationRemoveResult> {
    const discovered = await discoverMigrations(options.migrationsDir);
    const latest = discovered.migrations.at(-1);
    if (!latest) {
        throw new MigrationError('No migrations were found to remove.');
    }

    if (options.appliedMigrationIds?.includes(latest.migration.id)) {
        throw new MigrationError(`Migration '${latest.migration.id}' has already been applied to the database. Revert the database before removing the local migration file.`, {
            details: { migrationId: latest.migration.id },
        });
    }

    const previousSnapshot = latest.migration.previousSnapshot;
    const changes: AtomicFileChange[] = [
        { kind: 'remove', path: latest.filePath },
        ...previousSnapshot ? [{
            kind: 'write' as const,
            path: options.snapshotPath,
            contents: renderSnapshotSource(previousSnapshot),
            replace: true,
        }] : [],
    ];
    changeFilesAtomically(changes);

    return {
        removedMigrationId: latest.migration.id,
        removedMigrationPath: latest.filePath,
        restoredSnapshot: Boolean(previousSnapshot),
    };
}

/** Perform the list migrations operation. */ export async function listMigrations(migrationsDir: string): Promise<readonly DiscoveredMigration[]> {
    return (await discoverMigrations(migrationsDir)).migrations;
}

/** Configure pending model changes and return this builder. */ export function hasPendingModelChanges(
    context: ModelSnapshotSource,
    options: { /** The snapshot path. */ readonly snapshotPath: string },
): PendingModelChangesResult {
    const previousSnapshot = readSnapshotIfExists(options.snapshotPath) ?? { formatVersion: 1, entities: [] } satisfies ModelSnapshot;
    const diff = diffModelSnapshots(previousSnapshot, context.createModelSnapshot());
    return {
        hasPendingChanges: diff.hasChanges,
        operations: diff.operations.length,
        warnings: collectDestructiveWarnings(diff.operations),
    };
}

function readSnapshotIfExists(snapshotPath: string): ModelSnapshot | undefined {
    if (!fs.existsSync(snapshotPath)) {
        return undefined;
    }

    const source = fs.readFileSync(snapshotPath, 'utf8');
    const match = /export\s+default\s+([\s\S]*?)\s+satisfies\s+ModelSnapshot\s*;/.exec(source);
    if (!match) {
        return JSON.parse(source) as ModelSnapshot;
    }
    return JSON.parse(match[1]) as ModelSnapshot;
}
