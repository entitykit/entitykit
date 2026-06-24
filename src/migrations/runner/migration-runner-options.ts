import type {
    MigrationDiagnosticEvent,
} from '../../diagnostics/runtime/events';
import type { DatabaseOperationOptions } from '../../storage/database-connection';

/** Receives migration-only diagnostics from a standalone runner. */
export type MigrationDiagnosticsHandler = (
    event: MigrationDiagnosticEvent,
) => void;

/** Options shared by apply, revert, history, and update operations. */
export type MigrationOperationOptions = DatabaseOperationOptions;

/** Options for reading migration history without hidden database mutation. */
export interface MigrationHistoryOptions extends DatabaseOperationOptions {
    /** Create the history table when it does not exist. Defaults to true. */ readonly initializeHistory?: boolean;
}

/** Options that configure migration update. */ export interface MigrationUpdateOptions extends DatabaseOperationOptions {
    /** The target. */ readonly target?: string;
    /** The allow data loss. */ readonly allowDataLoss?: boolean;
}

/** Result produced by migration update. */ export interface MigrationUpdateResult {
    /** The applied migrations. */ readonly appliedMigrations: readonly string[];
    /** The used migration lock. */ readonly usedMigrationLock: boolean;
    /** The transaction suppressed statements. */ readonly transactionSuppressedStatements: number;
}

/** Options that configure migration runner diagnostics. */ export interface MigrationRunnerDiagnosticsOptions {
    /** Name of the configured database provider. */ readonly provider?: string;
    /** The diagnostics. */ readonly diagnostics?: readonly MigrationDiagnosticsHandler[];
}
