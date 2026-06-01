import {
    EntityKitError,
    type EntityKitErrorCode,
} from './entity-kit-error';

/** Options that configure migration error. */ export interface MigrationErrorOptions {
    /** Stable machine-readable error or provider code. */ readonly code?: Extract<EntityKitErrorCode, `MIGRATION${string}`>;
    /** Structured details for diagnostics and machine inspection. */ readonly details?: Readonly<Record<string, unknown>>;
    /** Original failure, when one is available. */ readonly cause?: unknown;
}

/** Typed error reported for migration failures. */ export class MigrationError extends EntityKitError {
    constructor(message: string, options: MigrationErrorOptions = {}) {
        super(message, {
            code: options.code ?? 'MIGRATION_ERROR',
            details: options.details,
            cause: options.cause,
        });
    }
}

/** Typed error reported for migration checksum failures. */ export class MigrationChecksumError extends MigrationError {
    constructor(migrationId: string) {
        super(
            `Applied migration '${migrationId}' checksum does not match the local migration file. Restore the exact applied migration file or create a corrective migration; do not edit an already-applied migration.`,
            { code: 'MIGRATION_CHECKSUM_MISMATCH', details: {
                migrationId,
                driftKind: 'checksumMismatch',
                nextAction: 'Restore the exact applied migration file or create a corrective migration.',
            } },
        );
        this.name = 'MigrationChecksumError';
    }
}

/** Typed error reported for migration data loss failures. */ export class MigrationDataLossError extends MigrationError {
    /** Destructive-change warnings that require explicit review. */
    public readonly warnings: readonly string[];

    constructor(warnings: readonly string[]) {
        super('Migration contains destructive changes. Re-run with --allow-data-loss after review.', {
            code: 'MIGRATION_DATA_LOSS',
            details: { warnings },
        });
        this.name = 'MigrationDataLossError';
        this.warnings = warnings;
    }
}

/** Options that configure migration execution error. */ export interface MigrationExecutionErrorOptions {
    /** The migration id. */ readonly migrationId: string;
    /** The migration name. */ readonly migrationName: string;
    /** The phase. */ readonly phase: 'apply' | 'rollback';
    /** The direction. */ readonly direction: 'up' | 'down';
    /** The statement count. */ readonly statementCount: number;
    /** The transaction suppressed statements. */ readonly transactionSuppressedStatements: number;
    /** Original failure, when one is available. */ readonly cause: unknown;
}

/** Typed error reported for migration execution failures. */ export class MigrationExecutionError extends MigrationError {
    constructor(options: MigrationExecutionErrorOptions) {
        const transactionMode = options.transactionSuppressedStatements > 0
            ? 'mixed transactional and transaction-suppressed statements'
            : 'transactional statements';
        const nextAction = options.transactionSuppressedStatements > 0
            ? 'Run db status, inspect the database for partial transaction-suppressed work, clean it up manually or create a corrective migration, then rerun db migrate.'
            : 'Run db status, review the failed statement, fix the migration or database state, then rerun db migrate.';

        super(
            [
                `Migration '${options.migrationId}' failed during ${options.phase}.`,
                `Transaction mode: ${transactionMode}.`,
                `Next action: ${nextAction}`,
            ].join(' '),
            { code: 'MIGRATION_EXECUTION', details: {
                migrationId: options.migrationId,
                migrationName: options.migrationName,
                phase: options.phase,
                direction: options.direction,
                statementCount: options.statementCount,
                transactionSuppressedStatements: options.transactionSuppressedStatements,
                transactionMode,
                nextAction,
            }, cause: options.cause },
        );
        this.name = 'MigrationExecutionError';
    }
}

/** Typed error reported for migration lock release failures. */ export class MigrationLockReleaseError extends MigrationError {
    /** The release error. */ public readonly releaseError: unknown;
    /** The primary error. */ public readonly primaryError?: unknown;

    constructor(releaseError: unknown, primaryError?: unknown) {
        super(
            primaryError
                ? 'Migration lock release failed after migration update failed.'
                : 'Migration lock release failed.',
            {
                code: 'MIGRATION_LOCK_RELEASE',
                details: { lockPhase: 'lockRelease', primaryError, releaseError },
                cause: releaseError,
            },
        );
        this.name = 'MigrationLockReleaseError';
        this.releaseError = releaseError;
        this.primaryError = primaryError;
    }
}

/** Typed error reported for pending model changes failures. */ export class PendingModelChangesError extends MigrationError {
    /** Number of model-diff operations not represented by a migration. */
    public readonly operations: number;

    constructor(operations: number) {
        super(`Pending model changes found (${String(operations)} operation(s)). Add a migration or update the snapshot.`, {
            code: 'MIGRATION_PENDING_MODEL_CHANGES',
            details: { operations },
        });
        this.name = 'PendingModelChangesError';
        this.operations = operations;
    }
}
