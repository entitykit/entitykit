import crypto from 'crypto';
import type { Migration } from './migration';
import {
    MigrationBuilder,
    type MigrationStatement,
} from './migration-builder';
import type { MigrationBuilderFactory } from './migration-builder-contract';
import type { SqlDialect } from '../sql/sql-dialect';
import { migrationChecksumPayload } from './migration-checksum-payload';
import { collectMigrationOperation } from './migration-operation-collector';

export const migrationHistoryTableName = '__entitykit_migrations';
export const migrationLockKey = 'entitykit:migrations';
export const entityKitMigrationVersion = '0.1.0-alpha.2';

/** Perform the migration checksum operation. */ export function migrationChecksum(
    migration: Migration,
    dialect?: SqlDialect,
    createBuilder: MigrationBuilderFactory = () => dialect === undefined
        ? new MigrationBuilder()
        : new MigrationBuilder(dialect),
): string {
    const upBuilder = collectMigrationOperation(migration, 'up', createBuilder);
    const downBuilder = collectMigrationOperation(migration, 'down', createBuilder);
    return migrationStatementsChecksum(
        upBuilder.statements,
        downBuilder.statements,
    );
}

export function migrationStatementsChecksum(
    upStatements: readonly MigrationStatement[],
    downStatements: readonly MigrationStatement[],
): string {
    return crypto
        .createHash('sha256')
        .update(migrationChecksumPayload(upStatements, downStatements))
        .digest('hex');
}
