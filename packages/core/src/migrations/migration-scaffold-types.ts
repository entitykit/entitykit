/**
 * Shared data shapes for migration scaffolding: the caller-supplied options and
 * the fully-computed result.
 *
 * These live apart from the orchestrator so the file-writing module can depend
 * on `MigrationScaffoldResult` without importing the orchestrator itself, which
 * would pull the whole rendering/diffing graph back in and risk an import cycle.
 */
import type { ModelDiffOperation, ModelDiffRenameHints } from './model-differ';

/** Options that configure migration scaffold. */ export interface MigrationScaffoldOptions {
    /** Stable name for this contract or database object. */ readonly name: string;
    /** The migrations dir. */ readonly migrationsDir: string;
    /** The snapshot path. */ readonly snapshotPath: string;
    /** The now. */ readonly now?: Date;
    /** The allow empty. */ readonly allowEmpty?: boolean;
    /** The rename hints. */ readonly renameHints?: ModelDiffRenameHints;
}

/** Result produced by migration scaffold. */ export interface MigrationScaffoldResult {
    /** The id. */ readonly id: string;
    /** The class name. */ readonly className: string;
    /** The migration path. */ readonly migrationPath: string;
    /** The snapshot path. */ readonly snapshotPath: string;
    /** The migration source. */ readonly migrationSource: string;
    /** The snapshot source. */ readonly snapshotSource: string;
    /** The operations. */ readonly operations: readonly ModelDiffOperation[];
    /** The warnings. */ readonly warnings: readonly string[];
    /** Whether changes. */ readonly hasChanges: boolean;
}
