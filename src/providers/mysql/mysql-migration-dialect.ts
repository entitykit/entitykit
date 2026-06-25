import type { Migration } from '../../migrations/migration';
import {
    entityKitMigrationVersion,
    migrationHistoryTableName,
    migrationLockKey,
} from '../../migrations/migration-metadata';
import type { MigrationSqlDialect } from '../../migrations/migration-sql-dialect';
import { MigrationError } from '../../errors/migration-errors';
import type { SqlStatement } from '../../sql/sql-statement';
import type { DatabaseQueryResult } from '../../storage/database-connection';
import { mySqlDialect } from './mysql-dialect';
import { quoteMysqlIdentifier } from './mysql-identifiers';

const historyColumns = ['id', 'name', 'checksum', 'entitykit_version'] as const;
const databaseScopedLockName =
    'concat(?, \':\', left(sha2(coalesce(database(), \'\'), 256), 40))';

/**
 * Migration SQL dialect for MySQL. The history table uses `varchar` rather than
 * `text`, since `text` cannot be a primary key. MySQL named locks serialize
 * migration runners on one pinned session; idempotent do-blocks remain absent.
 */
export const mySqlMigrationDialect: MigrationSqlDialect = Object.freeze({
    name: 'mysql',
    sql: mySqlDialect,
    createMigrationHistoryTableStatement(): SqlStatement {
        return {
            text: `create table if not exists ${quoteMysqlIdentifier(migrationHistoryTableName)} (${quoteMysqlIdentifier('id')} varchar(255) primary key, ${quoteMysqlIdentifier('name')} varchar(255) not null, ${quoteMysqlIdentifier('checksum')} varchar(255) not null, ${quoteMysqlIdentifier('entitykit_version')} varchar(255) not null)`,
            values: [],
            suppressTransaction: true,
        };
    },
    selectMigrationHistoryStatement(): SqlStatement {
        return {
            text: `select ${historyColumns.map(quoteMysqlIdentifier).join(', ')} from ${quoteMysqlIdentifier(migrationHistoryTableName)} order by ${quoteMysqlIdentifier('id')}`,
            values: [],
        };
    },
    migrationHistoryTableExistsStatement(): SqlStatement {
        return {
            text: `select exists (select 1 from information_schema.tables where table_schema = database() and table_name = ?) as ${mySqlDialect.quoteIdentifier('exists')}`,
            values: [migrationHistoryTableName],
        };
    },
    insertMigrationHistoryStatement(
        migration: Migration,
        checksum: string,
    ): SqlStatement {
        return {
            text: `insert into ${quoteMysqlIdentifier(migrationHistoryTableName)} (${historyColumns.map(quoteMysqlIdentifier).join(', ')}) values (?, ?, ?, ?)`,
            values: [
                migration.id,
                migration.name,
                checksum,
                entityKitMigrationVersion,
            ],
        };
    },
    deleteMigrationHistoryStatement(migration: Migration): SqlStatement {
        return {
            text: `delete from ${quoteMysqlIdentifier(migrationHistoryTableName)} where ${quoteMysqlIdentifier('id')} = ?`,
            values: [migration.id],
        };
    },
    acquireMigrationLockStatement(): SqlStatement {
        return {
            text: `select get_lock(${databaseScopedLockName}, -1) as acquired`,
            values: [migrationLockKey],
        };
    },
    releaseMigrationLockStatement(): SqlStatement {
        return {
            text: `select release_lock(${databaseScopedLockName}) as released`,
            values: [migrationLockKey],
        };
    },
    validateMigrationLockAcquired(result: DatabaseQueryResult): void {
        validateNamedLockResult(result, 'acquired', 'acquire');
    },
    validateMigrationLockReleased(result: DatabaseQueryResult): void {
        validateNamedLockResult(result, 'released', 'release');
    },
});

function validateNamedLockResult(
    result: DatabaseQueryResult,
    column: 'acquired' | 'released',
    action: 'acquire' | 'release',
): void {
    const value = result.rows[0]?.[column];
    if (Number(value) === 1) {
        return;
    }
    throw new MigrationError(
        `MySQL failed to ${action} the migration lock.`,
        {
            details: {
                lockPhase: action === 'acquire' ? 'lockAcquire' : 'lockRelease',
                result: value ?? null,
            },
        },
    );
}
