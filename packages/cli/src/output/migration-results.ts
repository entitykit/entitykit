import path from 'path';
import type { MigrationUpdateResult } from '../../migrations/migration-runner';

/** Render the result of applying migrations to a database. */
export function renderDatabaseUpdateResult(result: MigrationUpdateResult): string {
    const lines = [
        `Applied ${String(result.appliedMigrations.length)} migration step(s).`,
        `Migration lock: ${result.usedMigrationLock ? 'acquired' : 'not configured'}`,
        result.transactionSuppressedStatements > 0
            ? `Transactions: enabled; ${String(result.transactionSuppressedStatements)} statement(s) ran outside the transaction by request.`
            : 'Transactions: enabled',
    ];

    if (result.appliedMigrations.length > 0) {
        lines.push(...result.appliedMigrations);
    }

    return lines.join('\n');
}

/** Render the paths and warnings produced by migration scaffolding. */
export function renderAddResult(
    result: {
        readonly id: string;
        readonly migrationPath: string;
        readonly snapshotPath: string;
        readonly operations: number;
        readonly warnings: readonly string[];
    },
    projectRoot: string,
): string {
    const lines = [
        `Added migration ${result.id}.`,
        `Migration: ${path.relative(projectRoot, result.migrationPath)}`,
        `Snapshot: ${path.relative(projectRoot, result.snapshotPath)}`,
        `Operations: ${String(result.operations)}`,
    ];
    if (result.warnings.length > 0) {
        lines.push('', 'Warnings:', ...result.warnings.map(warning => `  - ${warning}`));
    }
    return lines.join('\n');
}
